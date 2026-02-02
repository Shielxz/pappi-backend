const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Cloudinary Configuration
cloudinary.config({
    cloud_name: 'dgk9bnhk2',
    api_key: '162824838158422',
    api_secret: 'cNDb2yNW7rpiAZzF8TwsL0zOxfs'
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'pappi_delivery',
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
        // 🚀 AUTO-OPTIMIZATION: Compress on upload
        transformation: [
            { quality: 'auto:good' },     // Smart compression (40-60% smaller)
            { fetch_format: 'auto' },      // WebP for supported browsers
            { width: 800, crop: 'limit' }  // Max 800px width, keep aspect ratio
        ],
        // Create thumbnail version automatically
        eager: [
            { width: 200, height: 200, crop: 'thumb', quality: 'auto:low' }
        ]
    },
});

module.exports = { cloudinary, storage };
