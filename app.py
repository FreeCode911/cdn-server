import os
import time
import base64
import random
import shutil
import requests
from flask import Flask, request, jsonify

app = Flask(__name__)
UPLOADS_DIR = "uploads"
PORT = 30009

# Ensure uploads directory exists
os.makedirs(UPLOADS_DIR, exist_ok=True)

# Cleanup function to clear leftover files in uploads folder on startup
def cleanup_uploads_folder():
    try:
        for file in os.listdir(UPLOADS_DIR):
            file_path = os.path.join(UPLOADS_DIR, file)
            os.remove(file_path)
            print(f"Cleaned up leftover file: {file_path}")
    except Exception as err:
        print(f"Failed to read uploads directory: {err}")

cleanup_uploads_folder()

# GitHub API Keys Rotation
GITHUB_KEYS = [
    os.getenv(f"GITHUB_TOKEN{i}") for i in range(12)
]
GITHUB_KEYS = [key for key in GITHUB_KEYS if key]
upload_count = 0

def get_api_key():
    global upload_count
    key = GITHUB_KEYS[(upload_count // 3) % len(GITHUB_KEYS)]
    upload_count += 1
    return key

# GitHub Repo Details
GITHUB_USERNAME = os.getenv("GITHUB_USERNAME")
GITHUB_REPO = os.getenv("GITHUB_REPO")
GITHUB_BRANCH = os.getenv("GITHUB_BRANCH", "main")
BASE_FOLDER = "cdn-1"
CUSTOM_FOLDER = "aura"
BASE_URL = "https://cdn.picgenv.us.kg/cdn1"
CUSTOM_URL = "https://cdn.prxy.us.kg/aura"

def upload_to_github(url, data, headers, retries=3):
    for attempt in range(1, retries + 1):
        try:
            return requests.put(url, json=data, headers=headers, timeout=15)
        except requests.RequestException as error:
            if attempt == retries:
                raise
            print(f"Retrying upload ({attempt}/{retries}) for GitHub user: {GITHUB_USERNAME}...")
            time.sleep(2)

@app.route("/upload", methods=["POST"])
def upload():
    file = request.files.get("file")
    if not file:
        return jsonify({"error": "No file uploaded"}), 400
    
    github_token = get_api_key()
    print(f"Now uploading file using GitHub user: {GITHUB_USERNAME}")
    
    folder = request.args.get("folder", "")
    random_id = random.randint(10000, 99999)
    file_ext = os.path.splitext(file.filename)[1]
    new_filename = f"{os.path.splitext(file.filename)[0]}_{random_id}{file_ext}"
    
    target_folder = f"{CUSTOM_FOLDER}/{folder}" if folder else BASE_FOLDER
    file_path = os.path.join(UPLOADS_DIR, new_filename)
    file.save(file_path)
    
    with open(file_path, "rb") as f:
        file_content = base64.b64encode(f.read()).decode()
    
    url = f"https://api.github.com/repos/{GITHUB_USERNAME}/{GITHUB_REPO}/contents/{target_folder}/{new_filename}?ref={GITHUB_BRANCH}"
    image_url = f"{CUSTOM_URL}/{folder}/{new_filename}" if folder else f"{BASE_URL}/{new_filename}"
    
    try:
        sha = None
        sha_response = requests.get(url, headers={"Authorization": f"token {github_token}"})
        if sha_response.status_code == 200:
            sha = sha_response.json().get("sha")
            print("Existing file found. Using SHA for update.")
    except:
        print("No existing file found, proceeding with new upload.")
    
    upload_to_github(
        url,
        {
            "message": f"Uploaded {new_filename} {image_url}",
            "content": file_content,
            "branch": GITHUB_BRANCH,
            "sha": sha,
        },
        {"Authorization": f"token {github_token}"}
    )
    
    os.remove(file_path)
    print(f"Cleaned up file {file_path} after successful upload.")
    return jsonify({"success": True, "url": image_url})

@app.route("/delete", methods=["DELETE"])
def delete():
    github_token = get_api_key()
    folder = request.args.get("folder", "")
    filename = request.args.get("filename")
    if not filename:
        return jsonify({"error": "Filename is required"}), 400
    
    target_folder = f"{CUSTOM_FOLDER}/{folder}" if folder else BASE_FOLDER
    file_path = f"{target_folder}/{filename}"
    url = f"https://api.github.com/repos/{GITHUB_USERNAME}/{GITHUB_REPO}/contents/{file_path}?ref={GITHUB_BRANCH}"
    
    print(f"Now deleting file {filename} from folder {target_folder} using GitHub user: {GITHUB_USERNAME}")
    
    try:
        sha_response = requests.get(url, headers={"Authorization": f"token {github_token}"})
        sha = sha_response.json().get("sha")
        
        requests.delete(
            url,
            headers={"Authorization": f"token {github_token}"},
            json={"message": f"Deleted {filename}", "sha": sha, "branch": GITHUB_BRANCH},
        )
        print(f"File {filename} deleted successfully from GitHub repo for user: {GITHUB_USERNAME}")
        return jsonify({"success": True, "message": f"Deleted {filename}"})
    except requests.RequestException as error:
        print("GitHub Delete Error:", error)
        return jsonify({"error": "Failed to delete file"}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
