const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');
const { Connection, Request, TYPES } = require('tedious');

// IMPORTANT: Your dbConfig object should be here
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
        const headers = { 'Access-control-allow-origin': '*', 'Access-control-allow-methods': 'POST, OPTIONS', 'Access-control-allow-headers': 'Content-Type' };
        if (request.method === 'OPTIONS') { return { status: 204, headers: headers }; }

        let connection;
        try {
            const formData = await request.formData();
            const file = formData.get('file');
            const username = formData.get('username');

            if (!file || !username) {
                return { status: 400, headers: headers, body: 'File and username are required.' };
            }

            const connectionString = process.env.AzureWebJobsStorage_ConnectionString;
            const buffer = Buffer.from(await file.arrayBuffer());
            const blobName = `${username}-avatar-${Date.now()}.jpg`;
            const containerName = 'avatars';

            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            const containerClient = blobServiceClient.getContainerClient(containerName);
            await containerClient.createIfNotExists({ access: 'blob' });
            const blockBlobClient = containerClient.getBlockBlobClient(blobName);
            await blockBlobClient.uploadData(buffer, { blobHTTPHeaders: { blobContentType: file.type } });
            const avatarUrl = blockBlobClient.url;
            context.log(`Avatar uploaded to ${avatarUrl}`);

            connection = new Connection(dbConfig);
            await new Promise((resolve, reject) => connection.connect(err => err ? reject(err) : resolve()));

            const sql = 'UPDATE Users SET AvatarURL = @AvatarURL WHERE Username = @Username';
            const req = new Request(sql, (err) => {
                if (err) {
                    context.log.error(`DB Update Error: ${err}`);
                }
            });
            req.addParameter('AvatarURL', TYPES.NVarChar, avatarUrl);
            req.addParameter('Username', TYPES.NVarChar, username);

            await new Promise((resolve, reject) => {
                req.on('requestCompleted', resolve);
                req.on('error', reject);
                connection.execSql(req);
            });

            context.log(`Avatar URL for ${username} updated in database.`);

            return { status: 200, headers: headers, jsonBody: { message: "Avatar updated successfully!", avatarUrl: avatarUrl } };

        } catch (error) {
            context.log(`Avatar Upload Error: ${error.message}`);
            return { status: 500, headers: headers, body: 'Server error during avatar upload.' };
        } finally {
            if (connection && connection.closed === false) {
                connection.close();
            }
        }
    }
});