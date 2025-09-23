const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');
const { Connection, Request, TYPES } = require('tedious');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

// --- Shared Database Configuration ---
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

// --- Shared CORS Headers ---
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

//================================================================================
//                             FUNCTION: getHomepage
//================================================================================
app.http('getHomepage', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: (request, context) => {
        context.log("Serving index.html");
        // This path assumes a 'frontend' folder at the root of your project
        const htmlPath = path.resolve(__dirname, '../frontend/index.html');
        try {
            const htmlContent = fs.readFileSync(htmlPath, 'utf8');
            return {
                status: 200,
                headers: { 'Content-Type': 'text/html' },
                body: htmlContent
            };
        } catch (error) {
            context.log.error(`Error reading HTML file: ${error.message}`);
            return { status: 500, body: 'Could not load homepage.' };
        }
    }
});

//================================================================================
//                             FUNCTION: register
//================================================================================
app.http('register', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        if (request.method === 'OPTIONS') { return { status: 204, headers: corsHeaders }; }
        let connection;
        try {
            const { username, password } = await request.json();
            if (!username || !password) {
                return { status: 400, headers: corsHeaders, body: 'Username and password are required.' };
            }
            const saltRounds = 10;
            const passwordHash = await bcrypt.hash(password, saltRounds);
            connection = new Connection(dbConfig);
            await new Promise((resolve, reject) => connection.connect(err => err ? reject(err) : resolve()));
            await new Promise((resolve, reject) => {
                const sql = 'INSERT INTO Users (Username, PasswordHash) VALUES (@Username, @PasswordHash)';
                const req = new Request(sql, (err) => {
                    if (err) {
                        if (err.message.includes('Violation of UNIQUE KEY constraint')) {
                            reject(new Error('Username already exists.'));
                        } else {
                            reject(err);
                        }
                    } else {
                        resolve();
                    }
                });
                req.addParameter('Username', TYPES.NVarChar, username);
                req.addParameter('PasswordHash', TYPES.NVarChar, passwordHash);
                connection.execSql(req);
            });
            return { status: 201, headers: corsHeaders, jsonBody: { message: 'User registered successfully!' } };
        } catch (error) {
            context.log(`Registration Error: ${error.message}`);
            if (error.message === 'Username already exists.') {
                return { status: 409, headers: corsHeaders, body: error.message };
            }
            return { status: 500, headers: corsHeaders, body: 'Server error during registration.' };
        } finally {
            if (connection && !connection.closed) { connection.close(); }
        }
    }
});

//================================================================================
//                             FUNCTION: login
//================================================================================
app.http('login', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        if (request.method === 'OPTIONS') { return { status: 204, headers: corsHeaders }; }
        let connection;
        try {
            const { username, password } = await request.json();
            if (!username || !password) {
                return { status: 400, headers: corsHeaders, body: 'Username and password are required.' };
            }
            connection = new Connection(dbConfig);
            await new Promise((resolve, reject) => connection.connect(err => err ? reject(err) : resolve()));
            const storedHash = await new Promise((resolve, reject) => {
                const sql = 'SELECT PasswordHash FROM Users WHERE Username = @Username';
                const req = new Request(sql, (err, rowCount) => {
                    if (err) { reject(err); return; }
                    if (rowCount === 0) { reject(new Error('Invalid credentials.')); }
                });
                let hash = null;
                req.on('row', (columns) => { hash = columns[0].value; });
                req.on('requestCompleted', () => resolve(hash));
                req.on('error', reject);
                req.addParameter('Username', TYPES.NVarChar, username);
                connection.execSql(req);
            });
            if (!storedHash) {
                return { status: 401, headers: corsHeaders, body: 'Invalid credentials.' };
            }
            const passwordMatch = await bcrypt.compare(password, storedHash);
            if (passwordMatch) {
                return { status: 200, headers: corsHeaders, jsonBody: { message: 'Login successful!', username: username } };
            } else {
                return { status: 401, headers: corsHeaders, body: 'Invalid credentials.' };
            }
        } catch (error) {
            context.log(`Login Error: ${error.message}`);
            if (error.message === 'Invalid credentials.') {
                return { status: 401, headers: corsHeaders, body: 'Invalid credentials.' };
            }
            return { status: 500, headers: corsHeaders, body: 'Server error during login.' };
        } finally {
            if (connection && !connection.closed) { connection.close(); }
        }
    }
});

//================================================================================
//                             FUNCTION: upload (Photo)
//================================================================================
app.http('upload', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        if (request.method === 'OPTIONS') { return { status: 204, headers: corsHeaders }; }
        let connection;
        try {
            const formData = await request.formData();
            const file = formData.get('file');
            const caption = formData.get('caption');
            const username = formData.get('username');
            if (!file || !username) {
                return { status: 400, headers: corsHeaders, body: 'File and username are required.' };
            }
            const storageConnectionString = process.env.AzureWebJobsStorage_ConnectionString;
            const buffer = Buffer.from(await file.arrayBuffer());
            const blobName = uuidv4() + '-' + file.name;
            const containerName = 'photos';
            const blobServiceClient = BlobServiceClient.fromConnectionString(storageConnectionString);
            const containerClient = blobServiceClient.getContainerClient(containerName);
            await containerClient.createIfNotExists({ access: 'blob' });
            const blockBlobClient = containerClient.getBlockBlobClient(blobName);
            await blockBlobClient.uploadData(buffer, { blobHTTPHeaders: { blobContentType: file.type } });
            const fileUrl = blockBlobClient.url;
            connection = new Connection(dbConfig);
            await new Promise((resolve, reject) => connection.connect(err => err ? reject(err) : resolve()));
            await new Promise((resolve, reject) => {
                const sql = 'INSERT INTO Photos (PhotoURL, Caption, Username) VALUES (@PhotoURL, @Caption, @Username)';
                const req = new Request(sql, (err) => {
                    if (err) { reject(err); } else { resolve(); }
                });
                req.addParameter('PhotoURL', TYPES.NVarChar, fileUrl);
                req.addParameter('Caption', TYPES.NVarChar, caption);
                req.addParameter('Username', TYPES.NVarChar, username);
                connection.execSql(req);
            });
            return { status: 200, headers: corsHeaders, jsonBody: { message: "Photo uploaded successfully!", url: fileUrl } };
        } catch (error) {
            context.log(`Upload Error: ${error.message}`);
            return { status: 500, headers: corsHeaders, body: 'Server error during upload.' };
        } finally {
            if (connection && !connection.closed) { connection.close(); }
        }
    }
});

//================================================================================
//                             FUNCTION: getPhotos (All)
//================================================================================
app.http('getPhotos', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        if (request.method === 'OPTIONS') { return { status: 204, headers: corsHeaders }; }
        let connection;
        const photos = [];
        try {
            connection = new Connection(dbConfig);
            await new Promise((resolve, reject) => connection.connect(err => err ? reject(err) : resolve()));
            await new Promise((resolve, reject) => {
                const sql = 'SELECT Id, PhotoURL, Caption, Likes, Username FROM Photos ORDER BY CreatedAt DESC';
                const req = new Request(sql, (err) => {
                    if (err) { reject(err); } else { resolve(); }
                });
                req.on('row', (columns) => {
                    const photo = {};
                    columns.forEach(column => { photo[column.metadata.colName] = column.value; });
                    photos.push(photo);
                });
                req.on('requestCompleted', () => resolve());
                req.on('error', reject);
                connection.execSql(req);
            });
            return { status: 200, headers: corsHeaders, jsonBody: photos };
        } catch (error) {
            context.log(`DB Error: ${error.message}`);
            return { status: 500, headers: corsHeaders, body: 'Error getting photos.' };
        } finally {
            if (connection && !connection.closed) { connection.close(); }
        }
    }
});

//================================================================================
//                             FUNCTION: getMyPhotos
//================================================================================
app.http('getMyPhotos', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        if (request.method === 'OPTIONS') { return { status: 204, headers: corsHeaders }; }
        const username = request.query.get('username');
        if (!username) {
            return { status: 400, headers: corsHeaders, body: 'Please provide a username.' };
        }
        let connection;
        const photos = [];
        try {
            connection = new Connection(dbConfig);
            await new Promise((resolve, reject) => connection.connect(err => err ? reject(err) : resolve()));
            await new Promise((resolve, reject) => {
                const sql = 'SELECT Id, PhotoURL, Caption, Likes, Username FROM Photos WHERE Username = @Username ORDER BY CreatedAt DESC';
                const req = new Request(sql, (err) => {
                    if (err) { reject(err); } else { resolve(); }
                });
                req.addParameter('Username', TYPES.NVarChar, username);
                req.on('row', (columns) => {
                    const photo = {};
                    columns.forEach(column => { photo[column.metadata.colName] = column.value; });
                    photos.push(photo);
                });
                req.on('requestCompleted', () => resolve());
                req.on('error', reject);
                connection.execSql(req);
            });
            return { status: 200, headers: corsHeaders, jsonBody: photos };
        } catch (error) {
            context.log(`Error getting user photos: ${error.message}`);
            return { status: 500, headers: corsHeaders, body: 'Error getting user photos.' };
        } finally {
            if (connection && !connection.closed) { connection.close(); }
        }
    }
});

//================================================================================
//                             FUNCTION: likePhoto
//================================================================================
app.http('likePhoto', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        if (request.method === 'OPTIONS') { return { status: 204, headers: corsHeaders }; }

        let connection;
        try {
            // Your frontend now needs to send both 'id' and 'username'
            const { id, username } = await request.json();
            if (!id || !username) {
                return { status: 400, headers: corsHeaders, body: 'Please provide a photo ID and username.' };
            }

            connection = new Connection(dbConfig);
            await new Promise((resolve, reject) => connection.connect(err => err ? reject(err) : resolve()));

            // --- First, update the likes count (your original code) ---
            await new Promise((resolve, reject) => {
                const sql = 'UPDATE Photos SET Likes = Likes + 1 WHERE Id = @Id';
                const req = new Request(sql, (err, rowCount) => {
                    if (err) { reject(err); }
                    else if (rowCount === 0) { reject(new Error('Photo not found.')); }
                    else { resolve(); }
                });
                req.addParameter('Id', TYPES.Int, id);
                connection.execSql(req);
            });

            // --- NEW CODE: Now, record which user liked the photo ---
            await new Promise((resolve, reject) => {
                const sql = 'INSERT INTO PhotoLikes (PhotoId, Username) VALUES (@PhotoId, @Username)';
                const req = new Request(sql, (err) => {
                    // Ignore unique key errors, which happen if the user clicks like twice quickly
                    if (err && !err.message.includes('Violation of UNIQUE KEY constraint')) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
                req.addParameter('PhotoId', TYPES.Int, id);
                req.addParameter('Username', TYPES.NVarChar, username);
                connection.execSql(req);
            });
            // --- END OF NEW CODE ---

            return { status: 200, headers: corsHeaders, jsonBody: { success: true } };
        } catch (error) {
            context.log(`Error liking photo: ${error.message}`);
            return { status: 500, headers: corsHeaders, body: `Server error: ${error.message}` };
        } finally {
            if (connection && !connection.closed) { connection.close(); }
        }
    }
});

//================================================================================
//                             FUNCTION: unlikePhoto
//================================================================================
app.http('unlikePhoto', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        if (request.method === 'OPTIONS') { return { status: 204, headers: corsHeaders }; }

        let connection;
        try {
            // Your frontend now needs to send both 'id' and 'username'
            const { id, username } = await request.json();
            if (!id || !username) {
                return { status: 400, headers: corsHeaders, body: 'Please provide a photo ID and username.' };
            }

            connection = new Connection(dbConfig);
            await new Promise((resolve, reject) => connection.connect(err => err ? reject(err) : resolve()));

            // --- First, update the likes count ---
            const likesResult = await new Promise((resolve, reject) => {
                const sql = 'UPDATE Photos SET Likes = CASE WHEN Likes > 0 THEN Likes - 1 ELSE 0 END OUTPUT INSERTED.Likes WHERE Id = @Id';
                const req = new Request(sql, (err, rowCount) => {
                    if (err) { reject(err); }
                    else if (rowCount === 0) { reject(new Error('Photo not found.')); }
                });
                req.addParameter('Id', TYPES.Int, id);
                let newLikes = 0;
                req.on('row', (columns) => { newLikes = columns[0].value; });
                req.on('requestCompleted', () => resolve(newLikes));
                req.on('error', reject);
                connection.execSql(req);
            });

            // --- NEW CODE: Now, remove the record of the user's like ---
            await new Promise((resolve, reject) => {
                const sql = 'DELETE FROM PhotoLikes WHERE PhotoId = @PhotoId AND Username = @Username';
                const req = new Request(sql, (err) => {
                    if (err) { reject(err); }
                    else { resolve(); }
                });
                req.addParameter('PhotoId', TYPES.Int, id);
                req.addParameter('Username', TYPES.NVarChar, username);
                connection.execSql(req);
            });
            // --- END OF NEW CODE ---

            return { status: 200, headers: corsHeaders, jsonBody: { message: 'Unlike registered successfully!', newLikes: likesResult } };
        } catch (error) {
            context.log(`Error unliking photo: ${error.message}`);
            return { status: 500, headers: corsHeaders, body: `Server error: ${error.message}` };
        } finally {
             if (connection && !connection.closed) { connection.close(); }
        }
    }
});

//================================================================================
//                             FUNCTION: deletePhoto
//================================================================================
app.http('deletePhoto', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        if (request.method === 'OPTIONS') { return { status: 204, headers: corsHeaders }; }
        let connection;
        try {
            const { id, username } = await request.json();
            if (!id || !username) {
                return { status: 400, headers: corsHeaders, body: 'Photo ID and username are required.' };
            }
            connection = new Connection(dbConfig);
            await new Promise((resolve, reject) => connection.connect(err => err ? reject(err) : resolve()));
            const photoURL = await new Promise((resolve, reject) => {
                const sql = 'SELECT PhotoURL FROM Photos WHERE Id = @Id AND Username = @Username';
                const req = new Request(sql, (err, rowCount) => {
                    if (err) { reject(err); }
                    if (rowCount === 0) { reject(new Error('Photo not found or user is not the owner.')); }
                });
                req.addParameter('Id', TYPES.Int, id);
                req.addParameter('Username', TYPES.NVarChar, username);
                let url = '';
                req.on('row', (columns) => { url = columns[0].value; });
                req.on('requestCompleted', () => resolve(url));
                req.on('error', reject);
                connection.execSql(req);
            });
            const blobName = photoURL.split('/').pop();
            const storageConnectionString = process.env.AzureWebJobsStorage_ConnectionString;
            const blobServiceClient = BlobServiceClient.fromConnectionString(storageConnectionString);
            const containerClient = blobServiceClient.getContainerClient('photos');
            await containerClient.deleteBlob(blobName);
            context.log(`Successfully deleted blob: ${blobName}`);
            await new Promise((resolve, reject) => {
                const sql = 'DELETE FROM Photos WHERE Id = @Id AND Username = @Username';
                const req = new Request(sql, (err) => {
                    if (err) { reject(err); } else { resolve(); }
                });
                req.addParameter('Id', TYPES.Int, id);
                req.addParameter('Username', TYPES.NVarChar, username);
                connection.execSql(req);
            });
            return { status: 200, headers: corsHeaders, jsonBody: { message: 'Post deleted successfully.' } };
        } catch (error) {
            context.log(`Delete Error: ${error.message}`);
            return { status: 500, headers: corsHeaders, body: `Server error: ${error.message}` };
        } finally {
            if (connection && !connection.closed) { connection.close(); }
        }
    }
});

//================================================================================
//                             FUNCTION: uploadAvatar
//================================================================================
app.http('uploadAvatar', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        if (request.method === 'OPTIONS') { return { status: 204, headers: corsHeaders }; }
        let connection;
        try {
            const formData = await request.formData();
            const file = formData.get('file');
            const username = formData.get('username');
            if (!file || !username) {
                return { status: 400, headers: corsHeaders, body: 'File and username are required.' };
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
            await new Promise((resolve, reject) => {
                const sql = 'UPDATE Users SET AvatarURL = @AvatarURL WHERE Username = @Username';
                const req = new Request(sql, (err) => {
                    if (err) { context.log.error(`DB Update Error: ${err}`); reject(err); } else { resolve(); }
                });
                req.addParameter('AvatarURL', TYPES.NVarChar, avatarUrl);
                req.addParameter('Username', TYPES.NVarChar, username);
                connection.execSql(req);
            });
            context.log(`Avatar URL for ${username} updated in database.`);
            return { status: 200, headers: corsHeaders, jsonBody: { message: "Avatar updated successfully!", avatarUrl: avatarUrl } };
        } catch (error) {
            context.log(`Avatar Upload Error: ${error.message}`);
            return { status: 500, headers: corsHeaders, body: 'Server error during avatar upload.' };
        } finally {
            if (connection && !connection.closed) { connection.close(); }
        }
    }
});

//================================================================================
//                             FUNCTION: getUserProfile
//================================================================================
app.http('getUserProfile', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        if (request.method === 'OPTIONS') { return { status: 204, headers: corsHeaders }; }
        const username = request.query.get('username');
        if (!username) { return { status: 400, headers: corsHeaders, body: 'Please provide a username.' }; }
        let connection;
        let userProfile = {};
        try {
            connection = new Connection(dbConfig);
            await new Promise((resolve, reject) => connection.connect(err => err ? reject(err) : resolve()));
            await new Promise((resolve, reject) => {
                const sql = 'SELECT Username, AvatarURL FROM Users WHERE Username = @Username';
                const req = new Request(sql, (err, rowCount) => {
                    if (err) { reject(err); }
                    else if (rowCount === 0) { reject(new Error('User not found.')); }
                    else { resolve(); }
                });
                req.addParameter('Username', TYPES.NVarChar, username);
                req.on('row', (columns) => {
                    columns.forEach(column => { userProfile[column.metadata.colName] = column.value; });
                });
                req.on('requestCompleted', () => resolve());
                req.on('error', reject);
                connection.execSql(req);
            });
            return { status: 200, headers: corsHeaders, jsonBody: userProfile };
        } catch (error) {
            context.log(`Get Profile Error: ${error.message}`);
            if (error.message === 'User not found.') {
                return { status: 404, headers: corsHeaders, body: error.message };
            }
            return { status: 500, headers: corsHeaders, body: 'Could not retrieve user profile.' };
        } finally {
            if (connection && !connection.closed) { connection.close(); }
        }
    }
});

//================================================================================
//                             FUNCTION: searchPhotos
//================================================================================
app.http('searchPhotos', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        if (request.method === 'OPTIONS') { return { status: 204, headers: corsHeaders }; }
        const searchTerm = request.query.get('term');
        if (!searchTerm) {
            return { status: 400, headers: corsHeaders, body: 'Please provide a search term.' };
        }
        let connection;
        const photos = [];
        try {
            connection = new Connection(dbConfig);
            await new Promise((resolve, reject) => connection.connect(err => err ? reject(err) : resolve()));
            await new Promise((resolve, reject) => {
                const sql = 'SELECT * FROM Photos WHERE Username LIKE @SearchPattern OR Caption LIKE @SearchPattern ORDER BY CreatedAt DESC';
                const req = new Request(sql, (err) => {
                    if (err) { reject(err); } else { resolve(); }
                });
                req.addParameter('SearchPattern', TYPES.NVarChar, `%${searchTerm}%`);
                req.on('row', (columns) => {
                    const photo = {};
                    columns.forEach(column => {
                        photo[column.metadata.colName] = column.value;
                    });
                    photos.push(photo);
                });
                req.on('requestCompleted', () => resolve());
                req.on('error', reject);
                connection.execSql(req);
            });
            return { status: 200, headers: corsHeaders, jsonBody: photos };
        } catch (error) {
            context.log(`Search Error: ${error.message}`);
            return { status: 500, headers: corsHeaders, body: 'Error searching photos.' };
        } finally {
            if (connection && !connection.closed) { connection.close(); }
        }
    }
});