import { initializeApp } from "firebase/app"
import { getAuth } from "firebase/auth"
import { getFirestore } from "firebase/firestore"
import { getGoogleConfig, type GoogleConfig } from "./googleConfig"

// Preserve the original site's optional firebase.json setup as well as Vite env.
const legacy = import.meta.glob<Partial<GoogleConfig>>("./firebase.json", {
  eager: true,
  import: "default",
})
const config = getGoogleConfig(import.meta.env, legacy["./firebase.json"])
export const app = config ? initializeApp(config) : undefined
export const firestore = app ? getFirestore(app) : undefined
export const auth = app ? getAuth(app) : undefined
