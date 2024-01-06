// Import necessary modules
const fs = require("fs");
const readline = require("readline");
const { google } = require("googleapis");
const cron=require('node-cron');

// Set the path for the token file
const tokenPath = "token.json";

// Read and parse the credentials from the credentials file
const credential = JSON.parse(fs.readFileSync("credential.json"));

// Extract necessary information from credentials for authentication
const { client_id, client_secret, redirect_uris } = credential.web;

// Create OAuth2 client for Google API authentication
const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

// Define the scopes for Gmail API
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

// Function to handle the authentication process
const authenticate = async () => {
  // Generate authorization URL
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("Authenticate by visiting this URL:", authUrl);

  // Get authorization code from the user
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const code = await new Promise((resolve) => {
    rl.question("Enter authorization code here: ", (enteredCode) => {
      rl.close();
      resolve(enteredCode);
    });
  });

  // Get tokens using the authorization code and set credentials
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);

  // Save tokens to the token file
  fs.writeFileSync(tokenPath, JSON.stringify(tokens));
};

// Function to load existing token or authenticate if not present
const loadToken = async () => {
  try {
    const token = fs.readFileSync(tokenPath);
    oAuth2Client.setCredentials(JSON.parse(token));
  } catch (error) {
    await authenticate();
  }
};

// Create Gmail API client
const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

// Function to check if a file exists
const fileExists = async (filePath) => {
  try {
    await fs.promises.access(filePath);
    return true; // File exists
  } catch (error) {
    return false; // File doesn't exist
  }
};

// Function to create a custom label if it doesn't exist
const createLabel = async () => {
  // Get existing labels
  const res = await gmail.users.labels.list({ userId: "me" });
  const labels = res.data.labels;
  //console.log(labels);
  // Check if the label already exists
  const labelExists = labels.some(
    (label) => label.name === "ON_VACATION_REPLIED"
  );

  if (!labelExists) {
    // Create the label
    const d = await gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name: "ON_VACATION_REPLIED",
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      },
    });

    // Save label information to a file
    console.log(d.data.id);
    fs.writeFileSync(
      "label",
      JSON.stringify({ name: "ON_VACATION_REPLIED", id: d.data.id })
    );
    console.log(`label created.`);
  }
};

// Function to reply to an email
const replyToEmail = async (emailId, subject, body) => {
  try {
    // Get the original email
    const email = await gmail.users.messages.get({
      userId: "me",
      id: emailId,
    });

    // Get the original sender's email address
    const originalSender = email.data.payload.headers.find(
      (header) => header.name === "From"
    ).value;

    // Send a reply email
    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: Buffer.from(
          `From: "me"\nTo: ${originalSender}\nSubject: ${subject}\n\n${body}`
        ).toString("base64"),
        threadId: emailId,
      },
    });

    // Get label ID from file
    const {id}=label = JSON.parse(fs.readFileSync("label"));
    

    // Modify labels to mark the email as replied and remove the unread label
    await gmail.users.messages.modify({
      userId: "me",
      id: emailId,
      requestBody: {
        addLabelIds: ["INBOX", id],
        removeLabelIds: ["UNREAD"],
      },
    });

    console.log("Reply has been sent.");
  } catch (err) {
    console.error(err);
  }
};

// Function to process and reply to emails
const processAndReplyToEmails = async () => {
  // console.log(gmail.users.messages)
  try {
    // Get a list of unread emails in the inbox
    const res = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["UNREAD", "INBOX"],
      maxResults: 5,
    });

    const emails = res.data.messages;
    if (emails && emails.length > 0) {
      console.log("Recent emails:");
      for (const email of emails) {
        // Get the details of each email
        const res = await gmail.users.messages.get({
          userId: "me",
          id: email.id,
        });

        const subject = res.data.payload.headers.find(
          (header) => header.name === "Subject"
        ).value;

        const from = res.data.payload.headers.find(
          (header) => header.name === "From"
        ).value;

        // Display email details
        console.log("From:", from);
        console.log("Subject:", subject);

        // Prepare a standard reply
        const replyBody =
          "Thank you for reaching out! We've received your message and will get back to you shortly.";

        // Reply to the email
        await replyToEmail(email.id, subject, replyBody);
      }
    } else {
      console.log("No new emails.");
    }
  } catch (err) {
    console.error(err);
  }
};

// Main application function
const openInApp = async () => {
  // Load existing token or authenticate if not present
  await loadToken();

  // Check if the label exists; if not, create it
  const labelCheck = await fileExists("generatedLabel");
  if (!labelCheck) {
    console.log("Checking for generatedLabel...");
    await createLabel();
  }

  // Set up a cron job to check for new emails every 2 minutes
  console.log("Checking for new emails every 2 minutes.");
  cron.schedule("*/2 * * * *", async () => {
    console.log("Checking for new emails...");
    await processAndReplyToEmails();
  });
};

// Run the application
openInApp();
