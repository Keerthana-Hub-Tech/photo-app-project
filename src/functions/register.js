const { app } = require('@azure/functions');
const { Connection, Request, TYPES } = require('tedious');
const bcrypt = require('bcrypt');

// IMPORTANT: Copy the dbConfig object from one of your other function files
const dbConfig = { 
            server: process.env.SQL_SERVER,
            authentication: {
                type: 'default',
                options: {
                    userName: process.env.SQL_USER,
                    password: process.env.SQL_PASSWORD
                }
            },
            options: {
                encrypt: true,
                database: process.env.SQL_DATABASE
            }
        };

app.http('register', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        // CORS Handling
        const headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        };
        if (request.method === 'OPTIONS') {
            return { status: 204, headers: headers };
        }

        try {
            const { username, password } = await request.json();

            if (!username || !password) {
                return { status: 400, headers: headers, body: 'Username and password are required.' };
            }

            // Hash the password
            const saltRounds = 10;
            const passwordHash = await bcrypt.hash(password, saltRounds);
            
            const connection = new Connection(dbConfig);
            
            await new Promise((resolve, reject) => {
                connection.on('connect', (err) => {
                    if (err) { reject(err); }
                    else {
                        const sql = 'INSERT INTO Users (Username, PasswordHash) VALUES (@Username, @PasswordHash)';
                        const req = new Request(sql, (err, rowCount) => {
                            connection.close();
                            if (err) {
                                // Check for unique constraint violation (username already exists)
                                if (err.message.includes('Violation of UNIQUE KEY constraint')) {
                                    reject(new Error('Username already exists.'));
                                } else {
                                    reject(err);
                                }
                            } else {
                                resolve();
                            }
                        });

                        req.addParameter('Username', TYPES.NVarChar, username);
                        req.addParameter('PasswordHash', TYPES.NVarChar, passwordHash);
                        
                        connection.execSql(req);
                    }
                });
                connection.connect();
            });

            return {
                status: 201, // 201 Created is a good status code for successful registration
                headers: headers,
                jsonBody: { message: 'User registered successfully!' }
            };
        } catch (error) {
            context.log(`Registration Error: ${error.message}`);
            // Send back a specific message if username is taken
            if (error.message === 'Username already exists.') {
                return { status: 409, headers: headers, body: error.message }; // 409 Conflict
            }
            return { status: 500, headers: headers, body: 'Server error during registration.' };
        }
    }
});