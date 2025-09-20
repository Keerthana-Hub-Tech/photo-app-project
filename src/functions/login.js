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

app.http('login', {
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
            
            const connection = new Connection(dbConfig);
            
            const storedHash = await new Promise((resolve, reject) => {
                connection.on('connect', (err) => {
                    if (err) { reject(err); }
                    else {
                        const sql = 'SELECT PasswordHash FROM Users WHERE Username = @Username';
                        const req = new Request(sql, (err, rowCount) => {
                            connection.close();
                            if (err) { 
                                reject(err); 
                            } else if (rowCount === 0) {
                                // User not found, reject with a specific error
                                reject(new Error('Invalid credentials.'));
                            }
                        });
                        
                        let hash = null;
                        req.on('row', (columns) => {
                            hash = columns[0].value;
                        });

                        req.on('requestCompleted', () => {
                            resolve(hash);
                        });

                        req.addParameter('Username', TYPES.NVarChar, username);
                        connection.execSql(req);
                    }
                });
                connection.connect();
            });

            if (!storedHash) {
                // This case handles if user was found but hash is null (shouldn't happen)
                 return { status: 401, headers: headers, body: 'Invalid credentials.' };
            }

            // Compare the submitted password with the stored hash
            const passwordMatch = await bcrypt.compare(password, storedHash);

            if (passwordMatch) {
                return {
                    status: 200,
                    headers: headers,
                    jsonBody: { message: 'Login successful!', username: username }
                };
            } else {
                return { status: 401, headers: headers, body: 'Invalid credentials.' }; // 401 Unauthorized
            }

        } catch (error) {
            context.log(`Login Error: ${error.message}`);
             // Send back a generic "invalid credentials" message for security
            if (error.message === 'Invalid credentials.') {
                return { status: 401, headers: headers, body: 'Invalid credentials.' };
            }
            return { status: 500, headers: headers, body: 'Server error during login.' };
        }
    }
});