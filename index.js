require("dotenv").config();
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { google } = require("googleapis");
const { Resend } = require("resend");
const { exec } = require("child_process");

// Init Resend API
const resend = new Resend(process.env.RESEND_API_KEY);

// Auth setup for Google APIs
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
  ],
});

// Google Drive service
const driveService = google.drive({ version: "v3", auth });

// Ask user for photographer
function askForPhotographer() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const photographersFilePath = path.join(__dirname, "fotografos.txt");

  fs.readFile(photographersFilePath, "utf8", (err, data) => {
    if (err) {
      console.error("❌ Error reading photographer file:", err);
      rl.close();
      return;
    }

    const photographers = data.split("\n").map((line) => {
      const [id, name, handle] = line.split("|").map((part) => part.trim());
      return { id, name, handle };
    });

    console.log("📸 Selecciona un fotógrafo por ID:");
    photographers.forEach((photographer) => {
      console.log(`${photographer.id} | ${photographer.name}`);
    });

    rl.question("Introduce el ID del fotógrafo (número): ", (id) => {
      const selectedPhotographer = photographers.find((p) => p.id === id);
      if (!selectedPhotographer) {
        console.log("❌ ID no válido. Prueba de nuevo.");
        rl.close();
        return askForPhotographer();
      }

      console.log(
        `✅ Fotógrafo seleccionado: ${selectedPhotographer.name} (${selectedPhotographer.handle})`
      );
      rl.close();

      // Set the selected photographer in the process environment to use throughout
      process.env.PHOTOGRAPHER_NAME = selectedPhotographer.name;
      process.env.PHOTOGRAPHER_HANDLE = selectedPhotographer.handle;

      // Proceed to ask for model folder
      askForFolder();
    });
  });
}

// Get model data from Google Sheets
async function getRecipientData(modelNumber) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: "Sheet1!A2:D1000",
  });

  const rows = response.data.values;
  if (!rows || rows.length === 0) {
    throw new Error("No hay datos en la hoja");
  }

  // Loop through the sheet until the right model is found
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const model = row[3];
    if (model === modelNumber) {
      return {
        email: row[1],
        name: row[2],
        rowIndex: i + 1, // +1 because we skipped the header
      };
    }
  }

  throw new Error("Modelo no encontrado en la hoja");
}

// Request model number folder and look for the pictures within it
// Will also display the first picture in the folder
function askForFolder() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question(
    "Introduce el modelo que deseas enviar: ",
    async (folderNumber) => {
      const folderPath = path.join(__dirname, "images", folderNumber);

      // First check if the specified folder exists
      if (!fs.existsSync(folderPath)) {
        console.error("❌ No existe el modelo:", folderPath);
        rl.close();
        return askForFolder();
      }

      // Gather all images contained within the folder
      const imageFiles = fs
        .readdirSync(folderPath)
        .filter((file) => /\.(jpg|jpeg|png|gif)$/i.test(file));

      // Return an error if the specified folder is empty
      if (imageFiles.length === 0) {
        console.log("❌ No hay imágenes en esta carpeta.");
        rl.close();
        return askForFolder();
      }

      try {

        // Get the email address, model name and row index from the Google Sheet
        const { email, name, rowIndex } = await getRecipientData(folderNumber);

        // Show the first picture in the folder using whatever image viewer is set by default on Windows
        const firstImagePath = path.join(folderPath, imageFiles[0]);
        exec(`start "" "${firstImagePath}"`);

        // Ask user to confirm the delivery
        rl.question(
          `¿Enviar modelo [${folderNumber}] a ${name} <${email}>? (S/N): `,
          (answer) => {
            rl.close();
            if (answer.trim().toUpperCase() === "S") {
              uploadAndSendEmail(
                folderNumber,
                folderPath,
                imageFiles,
                email,
                name,
                rowIndex
              );
            } else {
              askForFolder();
            }
          }
        );
      } catch (err) {
        console.error("⚠️ Error al obtener los datos del modelo:", err.message);
        rl.close();
        return askForFolder();
      }
    }
  );
}

// Create a Google Drive folder named after the model number that will be delivered
// Also declare the path to the JSON file that handles redirects (redirects to our own domain help prevent spam filtering)
const redirectMapPath = path.join(__dirname, "redirects.json");
async function createDriveFolder(folderName) {

  // Specify that a folder will be created
  const fileMetadata = {
    name: folderName,
    mimeType: "application/vnd.google-apps.folder",
    parents: [process.env.DRIVE_PARENT_FOLDER_ID], // Parent Google Drive folder ID defined in .env (MAKE SURE THAT IT HAS BEEN SHARED WITH THE SERVICE ACCOUNT EMAIL, IN EDIT MODE)
  };

  // Create the folder and retrieve its unique ID
  const file = await driveService.files.create({
    resource: fileMetadata,
    fields: "id",
  });
  const folderId = file.data.id;

  // Make folder public viewable
  await driveService.permissions.create({
    fileId: folderId,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });

  // Map the folder to JSON
  let redirectMap = {};
  if (fs.existsSync(redirectMapPath)) {
    redirectMap = JSON.parse(fs.readFileSync(redirectMapPath, "utf8"));
  }

  redirectMap[folderName] = folderId;
  fs.writeFileSync(redirectMapPath, JSON.stringify(redirectMap, null, 2));

  // Return both the URL and folder ID
  return {
    driveRawUrl: `https://drive.google.com/drive/folders/${folderId}`,
    convertedUrl: `https://mail.sharkburrito.com/view/${encodeURIComponent(folderName)}`, //FOR PRODUCTION
    //convertedUrl: `http://localhost:3000/view/${encodeURIComponent(folderName)}`, // FOR TESTING
  };
}


// Upload the specific model's pictures to the Google Drive folder that will be created
async function uploadImagesToDrive(folderName, folderPath, imageFiles) {

  // Create the folder
  console.log(`📁 Creando carpeta en Drive para el modelo ${folderName}...`);
  const driveFolder = await createDriveFolder(folderName);
  const driveFolderLink = driveFolder.driveRawUrl;
  const convertedFolderLink = driveFolder.convertedUrl;

  // Loop through all the pictures in the model's local folder until they are all uploaded
  console.log(`⬆️ Subiendo contenidos del modelo ${folderName}...`);
  for (const imageFile of imageFiles) {
    const filePath = path.join(folderPath, imageFile);
    const fileMetadata = {
      name: imageFile,
      parents: [driveFolderLink.split("/").pop()],
    };

    // Tell Google Drive that we will be uploading JPEGs
    const media = {
      mimeType: "image/jpeg",
      body: fs.createReadStream(filePath),
    };

    // Push each individual file to the Google Drive folder that has been created
    await driveService.files.create({
      resource: fileMetadata,
      media,
      fields: "id",
    });

    // Inform the user after each file has been uploaded so that there's a sense of progress
    console.log(`✏️ Subido: ${imageFile}`);
  }

  // Return the unique Google Drive URL that the model will be able to open on their browser
  //return driveFolderLink;
  return convertedFolderLink;
}

// Helper to convert HEX to RGB object for Sheets
function hexToRgbObject(hex) {
  const bigint = parseInt(hex.replace("#", ""), 16);
  return {
    red: ((bigint >> 16) & 255) / 255,
    green: ((bigint >> 8) & 255) / 255,
    blue: (bigint & 255) / 255,
  };
}

// Function to color a row in the sheet
async function colorSheetRow(rowIndex, color) {

  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: process.env.SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: 0, // usually 0; if not working, retrieve actual ID
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: 0,
              endColumnIndex: 4,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: hexToRgbObject(color),
              },
            },
            fields: "userEnteredFormat.backgroundColor",
          },
        },
      ],
    },
  });
}



// Write to a JSON file the result of the delivery
function logDelivery({
  folderNumber,
  recipientEmail,
  recipientName,
  status,
  message,
  photographerName,
  photographerHandle,
}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    modelNumber: folderNumber,
    recipient: {
      name: recipientName,
      email: recipientEmail,
    },
    photographer: {
      name: photographerName,
      handle: photographerHandle,
    },
    status: status, // "success" or "failed"
    message: message,
  };

  const logFilePath = path.join(__dirname, "delivery_log.json");

  let existingLogs = [];

  try {
    if (fs.existsSync(logFilePath)) {
      const data = fs.readFileSync(logFilePath, "utf8");
      existingLogs = JSON.parse(data);
    }
  } catch (err) {
    console.error("⚠️ Error escribiendo al log:", err.message);
  }

  existingLogs.push(logEntry);

  try {
    fs.writeFileSync(logFilePath, JSON.stringify(existingLogs, null, 2));
  } catch (err) {
    console.error("⚠️ Error escribiendo al log:", err.message);
  }
}

// Send HTML email to the model and link them to the Google Drive folder that has been created
async function sendEmail(
  folderNumber,
  folderPath,
  driveLink,
  recipientEmail,
  recipientName,
  targetRowIndex
) {
  const photographerName = process.env.PHOTOGRAPHER_NAME;
  const photographerHandle = process.env.PHOTOGRAPHER_HANDLE;
  const signaturePath = path.join(__dirname, "firma.png");
  const templatePath = path.join(__dirname, "emailTemplate.html");

  try {
    let htmlTemplate = fs.readFileSync(templatePath, "utf-8");

    htmlTemplate = htmlTemplate
      .replace("{{recipientName}}", recipientName)
      .replace("{{folderNumber}}", folderNumber)
      .replace("{{photographerName}}", photographerName)
      .replace("{{photographerHandle}}", photographerHandle)
      .replace("{{driveLink}}", driveLink);

    const signatureBuffer = fs.readFileSync(signaturePath);

    const formattedAttachments = [
      {
        filename: "firma.png",
        content: signatureBuffer.toString("base64"),
      },
    ];

    const fromEmail = `Fotografía CDO <${process.env.RESEND_FROM}>`;

    const emailResponse = await resend.emails.send({
      from: fromEmail,
      to: recipientEmail,
      subject: `¡Aquí están tus fotos de FicZone 2025, ${recipientName}!`,
      html: htmlTemplate,
      attachments: formattedAttachments,
    });

    console.log("✅ Email enviado con éxito: ", emailResponse);
    console.log("📊 Actualizando Excel...");

    await colorSheetRow(targetRowIndex, "#8ed4a0");

    logDelivery({
      folderNumber,
      recipientEmail,
      recipientName,
      status: "success",
      message: JSON.stringify(emailResponse),
      photographerName,
      photographerHandle,
    });

    return askForPhotographer();
  } catch (error) {
    console.log("❌ Error al enviar el mail:", error.message);
    console.log("📊 Actualizando Excel...");
    await colorSheetRow(targetRowIndex, "#d48e8e");

    logDelivery({
      folderNumber,
      recipientEmail,
      recipientName,
      status: "failed",
      message: error.message,
      photographerName,
      photographerHandle,
    });
  }
}

// Upload to Drive and send email
async function uploadAndSendEmail(
  folderNumber,
  folderPath,
  imageFiles,
  recipientEmail,
  recipientName,
  targetRowIndex
) {
  try {
    const driveLink = await uploadImagesToDrive(
      folderNumber,
      folderPath,
      imageFiles
    );

    await sendEmail(
      folderNumber,
      folderPath,
      driveLink,
      recipientEmail,
      recipientName,
      targetRowIndex
    );
  } catch (err) {
    console.error("❌ Error al subir las imágenes a Drive:", err.message);
    await colorSheetRow(targetRowIndex, "#d48e8e");
    logDelivery({
      folderNumber,
      recipientEmail,
      recipientName,
      status: "failed",
      message: err.message,
      photographerName: process.env.PHOTOGRAPHER_NAME,
      photographerHandle: process.env.PHOTOGRAPHER_HANDLE,
    });
    return askForPhotographer();
  }
}



// Start
askForPhotographer();
