const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// TODO: REPLACE WITH YOUR CREDENTIALS FROM CLOUDINARY DASHBOARD
cloudinary.config({
    cloud_name: 'dgk9bnhk2',
    api_key: '162824838158422',
    api_secret: 'cNDb2yNW7rpiAZzF8TwsL0zOxfs' // From user
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'pappi_delivery', // Folder name in Cloudinary
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    },
});

module.exports = { cloudinary, storage };
