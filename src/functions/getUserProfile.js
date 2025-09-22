const { app } = require('@azure/functions');
const { Connection, Request, TYPES } = require('tedious');

// IMPORTANT: Copy your dbConfig object here
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

app.http('getUserProfile', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
        if (request.method === 'OPTIONS') { return { status: 204, headers: headers }; }

        const username = request.query.get('username');
        if (!username) {
            return { status: 400, headers: headers, body: 'Please provide a username.' };
        }

        let userProfile = {};
        try {
            const connection = new Connection(dbConfig);
            await new Promise((resolve, reject) => {
                connection.on('connect', (err) => {
                    if (err) { reject(err); }
                    else {
                        const sql = 'SELECT Username, AvatarURL FROM Users WHERE Username = @Username';
                        const req = new Request(sql, (err, rowCount) => {
                            connection.close();
                            if (err) { reject(err); }
                            else if (rowCount === 0) { reject(new Error('User not found.')); }
                            else { resolve(); }
                        });

                        req.addParameter('Username', TYPES.NVarChar, username);

                       // This is the new, correct code
req.on('row', (columns) => {
    columns.forEach(column => {
        userProfile[column.metadata.colName] = column.value;
    });
});

                        connection.execSql(req);
                    }
                });
                connection.connect();
            });
        } catch (error) {
            context.log(`Get Profile Error: ${error.message}`);
            return { status: 500, headers: headers, body: 'Could not retrieve user profile.' };
        }

        return { status: 200, headers: headers, jsonBody: userProfile };
    }
});
