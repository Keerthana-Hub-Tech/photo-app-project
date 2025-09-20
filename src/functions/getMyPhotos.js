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

app.http('getMyPhotos', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        // CORS Handling
        const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
        if (request.method === 'OPTIONS') { return { status: 204, headers: headers }; }

        // Get the username from the query string, e.g., /api/getMyPhotos?username=keerthana
        const username = request.query.get('username');
        if (!username) {
            return { status: 400, headers: headers, body: 'Please provide a username.' };
        }

        let photos = [];
        try {
            const connection = new Connection(dbConfig);
            await new Promise((resolve, reject) => {
                connection.on('connect', (err) => {
                    if (err) { reject(err); }
                    else {
                        // SQL query that filters by username
                        const sql = 'SELECT Id, PhotoURL, Caption, Likes, Username FROM Photos WHERE Username = @Username ORDER BY CreatedAt DESC';
                        const req = new Request(sql, (err) => {
                            connection.close();
                            if (err) { reject(err); } else { resolve(); }
                        });

                        req.addParameter('Username', TYPES.NVarChar, username);

                        req.on('row', (columns) => {
                            const photo = {};
                            columns.forEach(column => {
                                photo[column.metadata.colName] = column.value;
                            });
                            photos.push(photo);
                        });

                        connection.execSql(req);
                    }
                });
                connection.connect();
            });
        } catch (error) {
            return { status: 500, headers: headers, body: 'Error getting user photos.' };
        }

        return { status: 200, headers: headers, jsonBody: photos };
    }
});