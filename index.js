const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const multer = require('multer');
const { google } = require('googleapis');

// Initialize Firebase Admin SDK
const serviceAccount = require('./larabase.json');

const port = process.env.PORT || 8080;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded

// Initialize multer for handling form-data
const upload = multer();

// Google Sheets API setup
const sheets = google.sheets('v4');
const auth = new google.auth.GoogleAuth({
  keyFile: "./rfidtelyu.json", // Path to your service account JSON file
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], // Scopes for Google Sheets
});

// Function to extract jenis from kode_barang
const extractJenis = (kode_barang) => {
  return kode_barang.substring(39, 41); // Extracts the 27th and 28th characters
};

// Function to ensure kode_barang is exactly 53 characters
const formatKodeBarang = (kode_barang) => {
  return kode_barang.length > 53 ? kode_barang.substring(0, 53) : kode_barang;
};

// Function to format date to "YYYY-MM-DD HH:mm:ss"
const formatDate = (date) => {
  const pad = (num) => (num < 10 ? '0' + num : num);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

// Get a specific item by ID
app.get('/api/items/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const doc = await db.collection('data_barang').doc(id).get();

    if (!doc.exists) {
      return res.status(404).send('Document not found');
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error('Error fetching document:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Get all items
app.get('/api/items', async (req, res) => {
  try {
    const snapshot = await db.collection('data_barang').get();
    const items = [];

    snapshot.forEach(doc => {
      items.push({ id: doc.id, ...doc.data() });
    });

    res.status(200).json(items);
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).send('Internal Server Error');
  }
});

// API to post barang_masuk
app.post('/api/items/masuk', upload.none(), async (req, res) => {
  let { kode_barang, ruangan, total, deteksi, pengiriman } = req.body; // Get kode_barang and ruangan from form-data

  // Format kode_barang to ensure it is exactly 53 characters
  kode_barang = formatKodeBarang(kode_barang);

  try {
    // Query to find the document with the matching kode_barang
    const barangQuery = await db.collection('data_barang').where('kode_barang', '==', kode_barang).get();

    let barangId;
    const jenis = extractJenis(kode_barang); // Extract jenis from kode_barang

    if (!barangQuery.empty) {
      const barangRef = barangQuery.docs[0].ref; // Get the reference of the first matching document
      barangId = barangRef.id; // Get the document ID

      // Update existing document
      await barangRef.update({
        stok_sekarang: admin.firestore.FieldValue.increment(1), // Increment current stock by 1
        updated_at: formatDate(new Date()), // Update timestamp
        status: "Masuk",
      });
    } else {
      // Create new document with default values
      barangId = admin.firestore().collection('data_barang').doc().id; // Generate a random UID
      await db.collection('data_barang').doc(barangId).set({
        id: barangId, // Use the newly generated ID
        kode_barang,
        jenis, // Set jenis extracted from kode_barang
        nama_barang: '', // Default value, adjust as needed
        nomor_rak: ruangan, // Default value, adjust as needed
        status: "Masuk", // Default value, adjust as needed
        stok_awal: 0, // Initialize starting stock
        stok_sekarang: 1, // Initialize current stock
        terkunci: 0, // Default value
        umur: 0, // Default value
        created_at: formatDate(new Date()), // Format date
        updated_at: formatDate(new Date()), // Format date
      });
    }

    // Generate a new random UID for barang_masuk
    const newBarangMasukId = admin.firestore().collection('barang_masuk').doc().id;

    // Add to barang_masuk collection
    await db.collection('barang_masuk').doc(newBarangMasukId).set({
      barang_id: barangId, // Use the ID from data_barang
      dilakukan_oleh: "Admin", // Default value, adjust as needed
      id: newBarangMasukId, // Use the newly generated ID
      jenis, // Set jenis extracted from kode_barang
      stok: 1, // Default value, adjust as needed
      tanggal_masuk: formatDate(new Date()), // Format date
      kode_barang,
      created_at: formatDate(new Date()), // Format date
    });

    // Prepare data for Google Sheets
    const sheetData = [
      [total, deteksi, pengiriman, formatDate(new Date())] // Data to be pushed to Google Sheets
    ];

    // Push data to Google Sheets
    const authClient = await auth.getClient();
    const spreadsheetId = '1xHz943KfpHVS3U8Wxtz4-kVduAt6JAWMxTWYN_cl8-U'; // Your Google Sheet ID
    const range = 'Sheet1!A:D'; // Adjust the range as needed

    await sheets.spreadsheets.values.append({
      auth: authClient,
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      resource: {
        values: sheetData,
      },
    });

    res.status(200).send('Barang masuk processed successfully and data pushed to Google Sheets');
  } catch (error) {
    console.error('Error processing barang masuk:', error);
    res.status(500).send('Internal Server Error');
  }
});

// API to post barang_keluar
app.post('/api/items/keluar', upload.none(), async (req, res) => {
  let { kode_barang, ruangan, total, deteksi, pengiriman } = req.body; // Get kode_barang and ruangan from form-data

  // Format kode_barang to ensure it is exactly 53 characters
  kode_barang = formatKodeBarang(kode_barang);

  try {
    // Query to find the document with the matching kode_barang
    const barangQuery = await db.collection('data_barang').where('kode_barang', '==', kode_barang).get();

    let barangId;
    const jenis = extractJenis(kode_barang); // Extract jenis from kode_barang

    if (!barangQuery.empty) {
      const barangRef = barangQuery.docs[0].ref; // Get the reference of the first matching document
      barangId = barangRef.id; // Get the document ID

      // Update existing document
      await barangRef.update({
        stok_sekarang: admin.firestore.FieldValue.increment(-1), // Decrement current stock by 1
        updated_at: formatDate(new Date()), // Update timestamp
        status: "Keluar",
      });
    } else {
      // Create new document with default values
      barangId = admin.firestore().collection('data_barang').doc().id; // Generate a random UID
      await db.collection('data_barang').doc(barangId).set({
        kode_barang,
        jenis, // Set jenis extracted from kode_barang
        nama_barang: '', // Default value, adjust as needed
        nomor_rak: ruangan, // Default value, adjust as needed
        status: "Keluar", // Default value, adjust as needed
        stok_awal: 0, // Initialize starting stock
        stok_sekarang: -1, // Initialize current stock
        terkunci: 0, // Default value
        umur: 0, // Default value
        created_at: formatDate(new Date()), // Format date
        updated_at: formatDate(new Date()), // Format date
      });
    }

    // Generate a new random UID for barang_keluar
    const newBarangKeluarId = admin.firestore().collection('barang_keluar').doc().id;

    // Add to barang_keluar collection
    await db.collection('barang_keluar').doc(newBarangKeluarId).set({
      barang_id: barangId, // Use the ID from data_barang
      dilakukan_oleh: "Admin", // Default value, adjust as needed
      id: newBarangKeluarId, // Use the newly generated ID
      jenis, // Set jenis extracted from kode_barang
      stok: 1, // Default value, adjust as needed
      tanggal_keluar: formatDate(new Date()), // Format date
      kode_barang,
      created_at: formatDate(new Date()), // Format date
    });

    // Prepare data for Google Sheets
    const sheetData = [
      [total, deteksi, pengiriman, formatDate(new Date())] // Data to be pushed to Google Sheets
    ];

    // Push data to Google Sheets
    const authClient = await auth.getClient();
    const spreadsheetId = '1xHz943KfpHVS3U8Wxtz4-kVduAt6JAWMxTWYN_cl8-U'; // Your Google Sheet ID
    const range = 'Sheet1!A:D'; // Adjust the range as needed

    await sheets.spreadsheets.values.append({
      auth: authClient,
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      resource: {
        values: sheetData,
      },
    });

    res.status(200).send('Barang keluar processed successfully and data pushed to Google Sheets');
  } catch (error) {
    console.error('Error processing barang keluar:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});