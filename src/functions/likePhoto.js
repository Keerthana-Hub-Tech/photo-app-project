const { app } = require('@azure/functions');
const { Connection, Request, TYPES } = require('tedious');

// Make sure your dbConfig object is here
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

app.http('likePhoto', {
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
            
            await new Promise((resolve, reject) => {
                connection.on('connect', (err) => {
                    if (err) { reject(err); }
                    else {
                        // Simpler SQL Query without the OUTPUT part
                        const sql = 'UPDATE Photos SET Likes = Likes + 1 WHERE Id = @Id';
                        const req = new Request(sql, (err, rowCount) => {
                            connection.close();
                            if (err) { reject(err); }
                            else if (rowCount === 0) { reject(new Error('Photo not found.')); }
                            else { resolve(); }
                        });

                        req.addParameter('Id', TYPES.Int, id);
                        connection.execSql(req);
                    }
                });
                connection.connect();
            });

            return {
                status: 200,
                headers: headers,
                jsonBody: { success: true }
            };
        } catch (error) {
            context.log(`Error liking photo: ${error.message}`);
            return { status: 500, headers: headers, body: `Server error: ${error.message}` };
        }
    }
});