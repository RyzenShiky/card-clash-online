/**
 * Centralized Firebase services.
 * File lain mengimpor dari sini, jangan initialize ulang.
 */
import app from "./config.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";

const auth = getAuth(app);
const database = getDatabase(app);

export { auth, database };
