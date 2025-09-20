const { app } = require('@azure/functions');
const { Connection, Request } = require('tedious');

// Make sure your dbConfig is here
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

app.http('getPhotos', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        // ... CORS handling is the same ...
        const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
        if (request.method === 'OPTIONS') { return { status: 204, headers: headers }; }
        
        let photos = [];
        try {
            const connection = new Connection(dbConfig);
            await new Promise((resolve, reject) => {
                connection.on('connect', (err) => {
                    if (err) { reject(err); }
                    else {
                        // UPDATED SQL to select Username
                        const sql = 'SELECT Id, PhotoURL, Caption, Likes, Username FROM Photos ORDER BY CreatedAt DESC';
                        const req = new Request(sql, (err) => {
                            connection.close();
                            if (err) { reject(err); } else { resolve(); }
                        });
                        
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
            context.log(`DB Error: ${error.message}`);
            return { status: 500, headers: headers, body: 'Error getting photos.' };
        }

        return { status: 200, headers: headers, jsonBody: photos };
    }
});
