const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
require("dotenv").config();

const app = express();
const port = 30009;
const upload = multer({ dest: "uploads/" });

const UPLOADS_DIR = path.join(__dirname, "uploads");

// Cleanup function to clear leftover files in uploads folder on startup
async function cleanupUploadsFolder() {
    try {
        const files = await fs.promises.readdir(UPLOADS_DIR);
        for (const file of files) {
            const filePath = path.join(UPLOADS_DIR, file);
            try {
                await fs.promises.unlink(filePath);
                console.log(`Cleaned up leftover file: ${filePath}`);
            } catch (err) {
                console.error(`Failed to delete file ${filePath}: ${err.message}`);
            }
        }
    } catch (err) {
        console.error(`Failed to read uploads directory: ${err.message}`);
    }
}

// Run cleanup on startup
cleanupUploadsFolder();

// GitHub API Keys Rotation
const GITHUB_KEYS = [
    process.env.GITHUB_TOKEN,
    process.env.GITHUB_TOKEN1,
    process.env.GITHUB_TOKEN2,
    process.env.GITHUB_TOKEN3,
    process.env.GITHUB_TOKEN4,
    process.env.GITHUB_TOKEN5,
    process.env.GITHUB_TOKEN6,
    process.env.GITHUB_TOKEN7,
    process.env.GITHUB_TOKEN8,
    process.env.GITHUB_TOKEN9,
    process.env.GITHUB_TOKEN10,
    process.env.GITHUB_TOKEN11,
];
let uploadCount = 0;

function getApiKey() {
    const key = GITHUB_KEYS[Math.floor(uploadCount / 3) % GITHUB_KEYS.length];
    uploadCount++;
    return key;
}

// GitHub Repo Details
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const BASE_FOLDER = "cdn-1";
const CUSTOM_FOLDER = "aura";
const BASE_URL = "https://cdn.picgenv.us.kg/cdn1";
const CUSTOM_URL = "https://cdn.prxy.us.kg/aura";

const axiosInstance = axios.create({
    timeout: 15000, // Increase timeout to 15 seconds
});

async function uploadToGitHub(url, data, headers, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await axiosInstance.put(url, data, {
                headers: { ...headers, Accept: "application/vnd.github.v3.raw" },
            });
        } catch (error) {
            if (attempt === retries) throw error;
            console.log(
                `Retrying upload (${attempt}/${retries}) for GitHub user: ${GITHUB_USERNAME}...`
            );
            await new Promise((res) => setTimeout(res, 2000)); // Wait before retrying
        }
    }
}

app.post("/upload", upload.single("file"), async (req, res) => {
    let filePath = null;
    try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        const githubToken = getApiKey(); // Get API key based on upload count
        console.log(`Now uploading file using GitHub user: ${GITHUB_USERNAME}`);

        const { folder } = req.query;
        const randomId = Math.floor(Math.random() * 100000);
        const fileExtension = path.extname(req.file.originalname);
        const newFileName = `${path.basename(
            req.file.originalname,
            fileExtension
        )}_${randomId}${fileExtension}`;

        let targetFolder = folder ? `${CUSTOM_FOLDER}/${folder}` : BASE_FOLDER;
        filePath = path.join(UPLOADS_DIR, newFileName);

        // Rename the file from multer's temp storage to our designated path
        await fs.promises.rename(req.file.path, filePath);
        console.log(`File renamed to ${newFileName} in uploads folder`);

        const fileContent = fs.readFileSync(filePath, { encoding: "base64" });

        const url = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${targetFolder}/${newFileName}?ref=${GITHUB_BRANCH}`;
        const imageUrl = folder
            ? `${CUSTOM_URL}/${folder}/${newFileName}`
            : `${BASE_URL}/${newFileName}`;
        let sha;
        try {
            const shaResponse = await axiosInstance.get(url, {
                headers: {
                    Authorization: `token ${githubToken}`,
                    Accept: "application/vnd.github.v3.raw",
                },
            });
            sha = shaResponse.data.sha;
            console.log(`Existing file found. Using SHA for update.`);
        } catch (err) {
            sha = undefined;
            console.log(`No existing file found, proceeding with new upload.`);
        }

        await uploadToGitHub(
            url,
            {
                message: `Uploaded ${newFileName} ${imageUrl}`,
                content: fileContent,
                branch: GITHUB_BRANCH,
                sha: sha || undefined,
            },
            { Authorization: `token ${githubToken}` }
        );
        console.log(
            `File ${newFileName} uploaded successfully for GitHub user: ${GITHUB_USERNAME}`
        );

        // Remove file from uploads folder after successful upload
        await fs.promises.unlink(filePath);
        console.log(`Cleaned up file ${filePath} after successful upload.`);

        res.json({ success: true, url: imageUrl });
    } catch (error) {
        console.error("GitHub Upload Error:", error.response?.data || error.message);
        // Attempt to clean up any leftover file in the uploads folder
        if (filePath && fs.existsSync(filePath)) {
            try {
                await fs.promises.unlink(filePath);
                console.log(`Cleaned up file ${filePath} due to error.`);
            } catch (err) {
                console.error(`Failed to clean up file ${filePath}: ${err.message}`);
            }
        }
        // Also check if multer's temporary file still exists
        if (req.file && req.file.path && fs.existsSync(req.file.path)) {
            try {
                await fs.promises.unlink(req.file.path);
                console.log(`Cleaned up temporary file ${req.file.path} due to error.`);
            } catch (err) {
                console.error(
                    `Failed to clean up temporary file ${req.file.path}: ${err.message}`
                );
            }
        }
        res.status(500).json({ error: "Failed to upload file" });
    }
});

app.delete("/delete", async (req, res) => {
    try {
        const githubToken = getApiKey();
        const { folder, filename } = req.query;
        if (!filename)
            return res.status(400).json({ error: "Filename is required" });

        let targetFolder = folder ? `${CUSTOM_FOLDER}/${folder}` : BASE_FOLDER;
        const filePath = `${targetFolder}/${filename}`;
        const url = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`;

        console.log(
            `Now deleting file ${filename} from folder ${targetFolder} using GitHub user: ${GITHUB_USERNAME}`
        );

        // Get SHA of file
        const shaResponse = await axios.get(url, {
            headers: { Authorization: `token ${githubToken}` },
        });
        const sha = shaResponse.data.sha;

        // Delete request
        await axios.delete(url, {
            headers: { Authorization: `token ${githubToken}` },
            data: {
                message: `Deleted ${filename}`,
                sha,
                branch: GITHUB_BRANCH,
            },
        });
        console.log(
            `File ${filename} deleted successfully from GitHub repo for user: ${GITHUB_USERNAME}`
        );
        res.json({ success: true, message: `Deleted ${filename}` });
    } catch (error) {
        console.error("GitHub Delete Error:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to delete file" });
    }
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
