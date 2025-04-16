// We are using a tool called Express to help us build a simple web server.
const express = require("express");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;
const AUTH_SECRET = process.env.REDIRECT_API_SECRET || "secret123";

// Parse JSON request bodies
app.use(express.json());

// PostgreSQL pool setup
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Ensure the redirects table exists
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS redirects (
      folder_name TEXT PRIMARY KEY,
      folder_id TEXT NOT NULL
    );
  `);
})();

// Function to fetch folderId from DB
async function getRedirect(folderName) {
  const res = await pool.query(
    "SELECT folder_id FROM redirects WHERE folder_name = $1",
    [folderName]
  );
  return res.rows[0]?.folder_id || null;
}

// Function to insert or update redirect in DB
async function setRedirect(folderName, folderId) {
  await pool.query(
    `INSERT INTO redirects (folder_name, folder_id)
     VALUES ($1, $2)
     ON CONFLICT (folder_name) DO UPDATE SET folder_id = EXCLUDED.folder_id`,
    [folderName, folderId]
  );
}

// GET redirect
app.get("/view/:folderName", async (req, res) => {
  try {
    const folderId = await getRedirect(req.params.folderName);
    if (!folderId) return res.status(404).send("Model folder not found.");
    res.redirect(`https://drive.google.com/drive/folders/${folderId}`);
  } catch (err) {
    console.error("Error fetching redirect:", err);
    res.status(500).send("Server error");
  }
});

// API to check if a folder exists
app.get("/exists/:folderName", async (req, res) => {
  try {
    const folderId = await getRedirect(req.params.folderName);
    if (!folderId) return res.status(404).send("Not found");
    res.json({ folderId });
  } catch (err) {
    console.error("Error checking folder existence:", err);
    res.status(500).send("Server error");
  }
});

// Redirect to Linktree
app.get("/linktree", (req, res) => {
  res.redirect("https://linktr.ee/cosplaydayoutsevilla");
});

// POST to add or update redirect
app.post("/update", async (req, res) => {
  const { folderName, folderId, secret } = req.body;

  if (secret !== AUTH_SECRET) return res.status(401).send("Unauthorized");
  if (!folderName || !folderId) return res.status(400).send("Missing folderName or folderId");

  try {
    await setRedirect(folderName, folderId);
    res.send("✅ Redirect updated");
  } catch (err) {
    console.error("Error saving redirect:", err);
    res.status(500).send("Failed to save redirect");
  }
});

// Health check endpoint
app.get("/status", (req, res) => {
  res.send("🟢 Redirect server is running");
});

// Start the server
app.listen(port, () => {
  console.log(`🚀 Server running.`);
});
