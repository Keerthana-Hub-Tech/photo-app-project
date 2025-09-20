const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');
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

app.http('deletePhoto', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        // CORS Handling
        const headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        };
        if (request.method === 'OPTIONS') { return { status: 204, headers: headers }; }

        try {
            const { id, username } = await request.json();
            if (!id || !username) {
                return { status: 400, headers: headers, body: 'Photo ID and username are required.' };
            }

            const connection = new Connection(dbConfig);
            let photoURL = '';

            // Step 1: Find the photo URL and confirm ownership
            await new Promise((resolve, reject) => {
                connection.on('connect', (err) => {
                    if (err) { reject(err); }
                    else {
                        const sql = 'SELECT PhotoURL FROM Photos WHERE Id = @Id AND Username = @Username';
                        const req = new Request(sql, (err, rowCount) => {
                            if (err) { connection.close(); reject(err); }
                            else if (rowCount === 0) { connection.close(); reject(new Error('Photo not found or user is not the owner.')); }
                        });
                        req.addParameter('Id', TYPES.Int, id);
                        req.addParameter('Username', TYPES.NVarChar, username);
                        req.on('row', (columns) => { photoURL = columns[0].value; });
                        req.on('requestCompleted', () => { resolve(); }); // Don't close connection yet
                        connection.execSql(req);
                    }
                });
                connection.connect();
            });

            // Step 2: Delete the blob from storage
            const blobName = photoURL.split('/').pop();
            const storageConnectionString = process.env.AzureWebJobsStorage_ConnectionString;
            const blobServiceClient = BlobServiceClient.fromConnectionString(storageConnectionString);
            const containerClient = blobServiceClient.getContainerClient('photos');
            await containerClient.deleteBlob(blobName);
            context.log(`Successfully deleted blob: ${blobName}`);

            // Step 3: Delete the record from the database
            await new Promise((resolve, reject) => {
                const sql = 'DELETE FROM Photos WHERE Id = @Id AND Username = @Username';
                const req = new Request(sql, (err, rowCount) => {
                    connection.close();
                    if (err) { reject(err); }
                    else { resolve(); }
                });
                req.addParameter('Id', TYPES.Int, id);
                req.addParameter('Username', TYPES.NVarChar, username);
                connection.execSql(req);
            });

            return { status: 200, headers: headers, jsonBody: { message: 'Post deleted successfully.' } };

        } catch (error) {
            context.log(`Delete Error: ${error.message}`);
            return { status: 500, headers: headers, body: `Server error: ${error.message}` };
        }
    }
});