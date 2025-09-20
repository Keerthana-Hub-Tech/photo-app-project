const { app } = require('@azure/functions');
const fs = require('fs');
const path = require('path');

app.http('getHomepage', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: (request, context) => {
        context.log("Serving index.html");
        
        // Find the path to the index.html file in the frontend folder
        const htmlPath = path.resolve(__dirname, '../../frontend/index.html');
        
        // Read the file content
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // Return the HTML content as the response
        return {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
            body: htmlContent
        };
    }
});