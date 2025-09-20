const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');
const { v4: uuidv4 } = require('uuid');

app.http('upload', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        context.log(`Http function processed request for url "${request.url}"`);

        // Get the connection string from application settings
        const connectionString = process.env.AzureWebJobsStorage_ConnectionString;
        if (!connectionString) {
            return { status: 500, body: "AzureWebJobsStorage_ConnectionString is not defined." };
        }

        // Get the uploaded file data from the request
        const blobData = await request.blob();
        const buffer = Buffer.from(await blobData.arrayBuffer());
        const contentType = blobData.type; // e.g., 'image/jpeg'

        // Create a unique name for the file
        const blobName = uuidv4() + '.jpg'; // Or derive extension from contentType

        // Define the container name
        const containerName = 'photos';

        try {
            // Connect to Azure Blob Storage
            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            const containerClient = blobServiceClient.getContainerClient(containerName);
            
            // Ensure the container exists
            await containerClient.createIfNotExists({ access: 'blob' });

            // Upload the file
            const blockBlobClient = containerClient.getBlockBlobClient(blobName);
            await blockBlobClient.uploadData(buffer, {
                blobHTTPHeaders: { blobContentType: contentType }
            });

            context.log(`File uploaded successfully to container ${containerName} as ${blobName}`);
            
            // Return a success response with the URL of the uploaded file
            const fileUrl = blockBlobClient.url;
            return {
                status: 200,
                jsonBody: {
                    message: "File uploaded successfully!",
                    url: fileUrl
                }
            };

        } catch (error) {
            context.log(`Error during blob upload: ${error.message}`);
            return { status: 500, body: `Error uploading file: ${error.message}` };
        }
    }
});