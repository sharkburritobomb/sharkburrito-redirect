const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

const mapFile = path.join(__dirname, "redirects.json");

function loadRedirects() {
  if (!fs.existsSync(mapFile)) return {};
  return JSON.parse(fs.readFileSync(mapFile, "utf8"));
}

app.get("/view/:folderName", (req, res) => {
  const redirects = loadRedirects();
  const folderName = req.params.folderName;
  const driveId = redirects[folderName];

  if (!driveId) {
    return res.status(404).send("🔍 No se encontró el modelo.");
  }

  const url = `https://drive.google.com/drive/folders/${driveId}`;
  console.log(`🚀 Redirect request received. Converting ${folderName} to ${url}`);

  return res.redirect(302, url);
});

app.listen(port, () => {
  console.log(`🚀 Redirect server running on http://localhost:${port}`);
});
