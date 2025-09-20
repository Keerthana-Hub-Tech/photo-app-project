const { app } = require('@azure/functions');
const { Connection, Request, TYPES } = require('tedious');

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

app.http('unlikePhoto', {
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
            const { id } = await request.json();
            if (!id) {
                return { status: 400, headers: headers, body: 'Please provide a photo ID.' };
            }

            const connection = new Connection(dbConfig);

            const likesResult = await new Promise((resolve, reject) => {
                connection.on('connect', (err) => {
                    if (err) { reject(err); }
                    else {
                        // SQL Query to decrease likes, but not below 0
                        const sql = 'UPDATE Photos SET Likes = CASE WHEN Likes > 0 THEN Likes - 1 ELSE 0 END OUTPUT INSERTED.Likes WHERE Id = @Id';
                        const req = new Request(sql, (err, rowCount) => {
                            connection.close();
                            if (err) { reject(err); }
                            else if (rowCount === 0) { reject(new Error('Photo not found.')); }
                        });

                        req.addParameter('Id', TYPES.Int, id);
                        let newLikes = 0;
                        req.on('row', (columns) => { newLikes = columns[0].value; });
                        req.on('requestCompleted', () => { resolve(newLikes); });
                        connection.execSql(req);
                    }
                });
                connection.connect();
            });

            return {
                status: 200,
                headers: headers,
                jsonBody: { message: 'Unlike registered successfully!', newLikes: likesResult }
            };
        } catch (error) {
            context.log(`Error unliking photo: ${error.message}`);
            return { status: 500, headers: headers, body: `Server error: ${error.message}` };
        }
    }
});