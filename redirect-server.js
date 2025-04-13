// We are using a tool called Express to help us build a simple web server.
const express = require("express");
// We need this to read and write files on our computer.
const fs = require("fs");
// This helps us work with file paths in a smart way.
const path = require("path");

// Let's create our web server using Express!
const app = express();
// This sets the port number the server will run on. If there's a setting in the computer, use that, otherwise use 3000.
const port = process.env.PORT || 3000;

// This line lets our server understand data that's sent in JSON format (like from an app or website).
app.use(express.json());

// This tells us where our file with all the saved redirects is located.
const mapFile = path.join(__dirname, "redirects.json");

// 📦 When the server starts, try to load the saved redirects from the file.
let redirects = {};
if (fs.existsSync(mapFile)) {
  // Read the file and turn the JSON text into an object we can use in code.
  redirects = JSON.parse(fs.readFileSync(mapFile, "utf8"));
}

// 💾 This function saves the redirects to the file so we don't lose them when the server restarts.
function saveRedirects() {
  fs.writeFileSync(mapFile, JSON.stringify(redirects, null, 2));
}

// 📬 This handles GET requests to /view/modelNumber
// If someone visits this link, we'll check if there's a matching folder and send them to Google Drive.
app.get("/view/:folderName", (req, res) => {
  const folderId = redirects[req.params.folderName]; // Grab the ID of the folder using the name they gave.
  if (!folderId) return res.status(404).send("Model folder not found."); // If we can't find it, say it's not found.
  res.redirect(`https://drive.google.com/drive/folders/${folderId}`); // Send them to the correct folder.
});

// Redirect to CDO's LINKTREE
app.get("/linktree", (req, res) => {
  res.redirect(`https://linktr.ee/cosplaydayoutsevilla`);
});

// 🔐 We can use this password to make sure only the right people can add or change redirects.
const AUTH_SECRET = process.env.REDIRECT_API_SECRET || "secret123";

// 🛠 This handles POST requests to /update
// It's used to add a new folder link or update an old one.
app.post("/update", (req, res) => {
  const { folderName, folderId, secret } = req.body;

  // If they didn't send the right secret password, don't let them update anything.
  if (secret !== AUTH_SECRET) {
    return res.status(401).send("Unauthorized");
  }

  // If they forgot to send either the folder name or ID, tell them something is missing.
  if (!folderName || !folderId) {
    return res.status(400).send("Missing folderName or folderId");
  }

  // Save the folder name and ID in our memory.
  redirects[folderName] = folderId;
  saveRedirects(); // Save the new info to the file.

  res.send("✅ Redirect updated"); // Let them know it worked.
});

// 🟢 Start the server and let us know it's running.
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});

// 📊 This is just a little check to make sure the server is working.
// If someone visits /status, it will say it's running.
app.get("/status", (req, res) => {
  res.send("🟢 Redirect server is running");
});
