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

app.http('searchPhotos', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
        if (request.method === 'OPTIONS') { return { status: 204, headers: headers }; }

        const searchTerm = request.query.get('term');
        if (!searchTerm) {
            return { status: 400, headers: headers, body: 'Please provide a search term.' };
        }

        let photos = [];
        try {
            const connection = new Connection(dbConfig);
            await new Promise((resolve, reject) => {
                connection.on('connect', (err) => {
                    if (err) { reject(err); }
                    else {
                        // Search either the Username or the Caption
                        const sql = 'SELECT * FROM Photos WHERE Username = @SearchTerm OR Caption LIKE @SearchPattern ORDER BY CreatedAt DESC';
                        const req = new Request(sql, (err) => {
                            connection.close();
                            if (err) { reject(err); } else { resolve(); }
                        });

                        req.addParameter('SearchTerm', TYPES.NVarChar, searchTerm);
                        req.addParameter('SearchPattern', TYPES.NVarChar, `%${searchTerm}%`); // Use LIKE for partial matches in captions

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
            return { status: 500, headers: headers, body: 'Error searching photos.' };
        }

        return { status: 200, headers: headers, jsonBody: photos };
    }
});