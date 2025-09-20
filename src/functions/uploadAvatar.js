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

app.http('uploadAvatar', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        // CORS Handling
        const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
        if (request.method === 'OPTIONS') { return { status: 204, headers: headers }; }

        try {
            const formData = await request.formData();
            const file = formData.get('file');
            const username = formData.get('username');

            if (!file || !username) {
                return { status: 400, body: 'File and username are required.' };
            }

            // 1. Upload new avatar to a separate 'avatars' container
            const connectionString = process.env.AzureWebJobsStorage_ConnectionString;
            const buffer = Buffer.from(await file.arrayBuffer());
            const blobName = `${username}-avatar.jpg`; // Overwrite existing avatar for simplicity
            const containerName = 'avatars';
            let avatarUrl = '';

            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            const containerClient = blobServiceClient.getContainerClient(containerName);
            await containerClient.createIfNotExists({ access: 'blob' });
            const blockBlobClient = containerClient.getBlockBlobClient(blobName);
            await blockBlobClient.uploadData(buffer, { blobHTTPHeaders: { blobContentType: file.type } });
            avatarUrl = blockBlobClient.url;
            context.log(`Avatar uploaded to ${avatarUrl}`);

            // 2. Update the User's record in the database
            const connection = new Connection(dbConfig);
            await new Promise((resolve, reject) => {
                connection.on('connect', (err) => {
                    if (err) { reject(err); }
                    else {
                        const sql = 'UPDATE Users SET AvatarURL = @AvatarURL WHERE Username = @Username';
                        const req = new Request(sql, (err) => {
                            connection.close();
                            if (err) { reject(err); } else { resolve(); }
                        });
                        req.addParameter('AvatarURL', TYPES.NVarChar, avatarUrl);
                        req.addParameter('Username', TYPES.NVarChar, username);
                        connection.execSql(req);
                    }
                });
                connection.connect();
            });
            context.log(`Avatar URL for ${username} updated in database.`);

            return { status: 200, headers: headers, jsonBody: { message: "Avatar updated successfully!", avatarUrl: avatarUrl } };

        } catch (error) {
            context.log(`Avatar Upload Error: ${error.message}`);
            return { status: 500, headers: headers, body: 'Server error during avatar upload.' };
        }
    }
});