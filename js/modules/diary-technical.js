/**
 * @file diary-technical.js
 * @version 1.0 (Phase 2 - Technical Diary)
 * @description Manages the extended technical diary logic, decoupled from the main app logic but integrated via UI.
 */
import { auth, db, getDocument, addDocument, updateDocument, subscribeDoc } from '../firebase-service.js';
import { triggerFeedback, handleOperationError, FEEDBACK } from './feedback-system.js';
import { showToast } from '../ui-core.js'; 
import { evolveUserAttributes } from './stats-evolution.js';

export async function submitTechnicalEntry(entryData) {
    if (!auth.currentUser) return triggerFeedback(FEEDBACK.AUTH.LOGIN_ERROR);

    try {
        const enrichedEntry = {
            ...entryData,
            uid: auth.currentUser.uid,
            timestamp: new Date().toISOString(), // Standard query field
            createdAt: new Date(), // Firestore timestamp
        };

        // Save to specialized collection
        const docRef = await addDocument("diarioTecnico", enrichedEntry);
        
        // Link to match if exists
        if (enrichedEntry.matchId) {
            // Optional: Update match with reference to this analysis? 
            // For now, we prefer one-way link: Diary -> Match
        }

        // Trigger Stats Engine (Phase 3)
        // Fire and forget, but inside try/catch to log errors
        evolveUserAttributes(auth.currentUser.uid, enrichedEntry).catch(console.error);

        triggerFeedback({ title: "BITÁCORA ACTUALIZADA", msg: "Análisis técnico registrado.", type: "success" });
        return docRef.id;
    } catch (e) {
        handleOperationError(e);
        throw e;
    }
}

/**
 * Retrieves technical diary entries for the current user.
 */
export async function getTechnicalHistory(limitCount = 20) {
    if (!auth.currentUser) return [];
    try {
        const { collection, query, where, orderBy, limit, getDocs } = await import('https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js');
        
        const q = query(
            collection(db, "diarioTecnico"), 
            where("uid", "==", auth.currentUser.uid),
            orderBy("timestamp", "desc"),
            limit(limitCount)
        );

        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
        console.error("Diary Fetch Error", e);
        return [];
    }
}

