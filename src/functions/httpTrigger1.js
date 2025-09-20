const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');
const { v4: uuidv4 } = require('uuid');
const { Connection, Request, TYPES } = require('tedious');

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

app.http('upload', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        // ... CORS handling is the same ...
        const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
        if (request.method === 'OPTIONS') { return { status: 204, headers: headers }; }

        try {
            const formData = await request.formData();
            const file = formData.get('file');
            const caption = formData.get('caption');
            const username = formData.get('username'); // Get the username

            if (!file || !username) {
                return { status: 400, body: 'File and username are required.' };
            }

            // 1. --- BLOB STORAGE LOGIC (No changes here) ---
            const connectionString = process.env.AzureWebJobsStorage_ConnectionString;
            const buffer = Buffer.from(await file.arrayBuffer());
            const blobName = uuidv4() + '-' + file.name;
            const containerName = 'photos';
            let fileUrl = '';

            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            const containerClient = blobServiceClient.getContainerClient(containerName);
            await containerClient.createIfNotExists({ access: 'blob' });
            const blockBlobClient = containerClient.getBlockBlobClient(blobName);
            await blockBlobClient.uploadData(buffer, { blobHTTPHeaders: { blobContentType: file.type } });
            fileUrl = blockBlobClient.url;
            
            // 2. --- SQL DATABASE LOGIC (Updated SQL query) ---
            const connection = new Connection(dbConfig);
            await new Promise((resolve, reject) => {
                connection.on('connect', (err) => {
                    if (err) { reject(err); }
                    else {
                        // UPDATED SQL to include Username
                        const sql = 'INSERT INTO Photos (PhotoURL, Caption, Username) VALUES (@PhotoURL, @Caption, @Username)';
                        const req = new Request(sql, (err) => {
                            connection.close();
                            if (err) { reject(err); } else { resolve(); }
                        });
                        req.addParameter('PhotoURL', TYPES.NVarChar, fileUrl);
                        req.addParameter('Caption', TYPES.NVarChar, caption);
                        req.addParameter('Username', TYPES.NVarChar, username); // Add username parameter
                        connection.execSql(req);
                    }
                });
                connection.connect();
            });

            return { status: 200, headers: headers, jsonBody: { message: "Success" } };

        } catch (error) {
            context.log(`Upload Error: ${error.message}`);
            return { status: 500, headers: headers, body: 'Server error during upload.' };
        }
    }
});