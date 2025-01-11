const express = require('express');  
const admin = require('firebase-admin');  
const bodyParser = require('body-parser');  
const multer = require('multer');  
const { google } = require('googleapis');  
  
// Initialize Firebase Admin SDK  
const serviceAccount = require('./larabase-2267e-e86df9492c61.json');  
admin.initializeApp({  
  credential: admin.credential.cert(serviceAccount),  
});  
  
const db = admin.firestore();  
const app = express();  
const port = process.env.PORT || 8080;  
  
// Middleware  
app.use(bodyParser.json());  
app.use(bodyParser.urlencoded({ extended: true }));  
const upload = multer();  
  
// Google Sheets API setup  
const sheets = google.sheets('v4');  
const auth = new google.auth.GoogleAuth({  
  keyFile: "./rfidtelyu-ccc2ceb41c1b.json",  
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],  
});  
  
// Utility Functions  
const extractJenis = (kode_barang) => kode_barang.substring(39, 41);  
const formatKodeBarang = (kode_barang) => kode_barang.length > 53 ? kode_barang.substring(0, 53) : kode_barang;  
const formatDate = (date) => {  
  const pad = (num) => (num < 10 ? '0' + num : num);  
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;  
};  
  
// Routes  
app.get('/api/items/:id', async (req, res) => {  
  const { id } = req.params;  
  try {  
    const doc = await db.collection('data_barang').doc(id).get();  
    if (!doc.exists) return res.status(404).send('Document not found');  
    res.status(200).json({ id: doc.id, ...doc.data() });  
  } catch (error) {  
    console.error('Error fetching document:', error);  
    res.status(500).send('Internal Server Error');  
  }  
});  
  
app.get('/api/items', async (req, res) => {  
  try {  
    const snapshot = await db.collection('data_barang').get();  
    const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));  
    res.status(200).json(items);  
  } catch (error) {  
    console.error('Error fetching documents:', error);  
    res.status(500).send('Internal Server Error');  
  }  
});  
  
const processItem = async (req, res, status) => {  
  let { kode_barang, ruangan, total, deteksi, pengiriman } = req.body;  
  kode_barang = formatKodeBarang(kode_barang);  
  
  try {  
    const barangQuery = await db.collection('data_barang').where('kode_barang', '==', kode_barang).get();  
    let barangId;  
    const jenis = extractJenis(kode_barang);  
  
    if (!barangQuery.empty) {  
      const barangRef = barangQuery.docs[0].ref;  
      barangId = barangRef.id;  
      await barangRef.update({  
        stok_sekarang: admin.firestore.FieldValue.increment(status === "Masuk" ? 1 : -1),  
        updated_at: formatDate(new Date()),  
        status,  
      });  
    } else {  
      barangId = admin.firestore().collection('data_barang').doc().id;  
      await db.collection('data_barang').doc(barangId).set({  
        id: barangId,  
        kode_barang,  
        jenis,  
        nama_barang: '',  
        nomor_rak: ruangan,  
        status,  
        stok_awal: 0,  
        stok_sekarang: status === "Masuk" ? 1 : -1,  
        terkunci: 0,  
        umur: 0,  
        created_at: formatDate(new Date()),  
        updated_at: formatDate(new Date()),  
      });  
    }  
  
    const newTransactionId = admin.firestore().collection(`barang_${status.toLowerCase()}`).doc().id;  
    await db.collection(`barang_${status.toLowerCase()}`).doc(newTransactionId).set({  
      barang_id: barangId,  
      dilakukan_oleh: "Admin",  
      id: newTransactionId,  
      jenis,  
      stok: 1,  
      [`tanggal_${status.toLowerCase()}`]: formatDate(new Date()),  
      kode_barang,  
      created_at: formatDate(new Date()),  
    });  
  
    const sheetData = [[kode_barang, total, deteksi, pengiriman, formatDate(new Date())]];  
    const authClient = await auth.getClient();  
    const spreadsheetId = '1xHz943KfpHVS3U8Wxtz4-kVduAt6JAWMxTWYN_cl8-U';  
    const range = 'Sheet2!A:D';  
  
    await sheets.spreadsheets.values.append({  
      auth: authClient,  
      spreadsheetId,  
      range,  
      valueInputOption: 'RAW',  
      resource: { values: sheetData },  
    });  
  
    res.status(200).send(`Barang ${status.toLowerCase()} processed successfully and data pushed to Google Sheets`);  
  } catch (error) {  
    console.error(`Error processing barang ${status.toLowerCase()}:`, error);  
    res.status(500).send('Internal Server Error');  
  }  
};  
  
app.post('/api/items/masuk', upload.none(), (req, res) => processItem(req, res, "Masuk"));  
app.post('/api/items/keluar', upload.none(), (req, res) => processItem(req, res, "Keluar"));  
  
// Start the server  
app.listen(port, () => {  
  console.log(`Server running on port ${port}`);  
});  
