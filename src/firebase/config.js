/**
 * Firebase configuration
 *
 * Catatan keamanan:
 * - Web API key BUKAN secret seperti password server.
 * - Proteksi utama: Authentication, Security Rules, App Check, dan backend validation.
 * - Jangan mengandalkan "menyembunyikan apiKey" sebagai keamanan database.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";

const firebaseConfig = {
    apiKey: "AIzaSyBuKGWmqlcB8Pp7aeSizCV3UdWE85WPWxE",
    authDomain: "card-clash-online-4db6b.firebaseapp.com",
    databaseURL: "https://card-clash-online-4db6b-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "card-clash-online-4db6b",
    storageBucket: "card-clash-online-4db6b.firebasestorage.app",
    messagingSenderId: "366559745583",
    appId: "1:366559745583:web:a39dceb02ca26dada998da",
    measurementId: "G-D7ZDEJSVWY"
};

const app = initializeApp(firebaseConfig);

export default app;
