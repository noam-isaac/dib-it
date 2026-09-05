import { Button } from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { useState } from "react"
import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth"
import { useAuthState } from "react-firebase-hooks/auth"
import { auth } from "../firebase"

const google = new GoogleAuthProvider()

const Header = () => {
  return (
    <div
      id="header"
      className="dont-print"
      style={{
        backgroundColor: "#4f6522",
        color: "white",
        width: "100%",
        height: 75,
        flex: "none",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      <a href="/">
        <img
          className="logo"
          src="https://arazim-project.com/logo.png"
          height={40}
          style={{ marginLeft: 10, marginRight: 20 }}
        />
      </a>
      <h3
        style={{ fontWeight: "bold", fontSize: "1.17em" }}
        className="show-wide"
      >
        ארזים | Dib It
      </h3>
      <a
        href="https://github.com/arazimproject/dib-it"
        className="link show-wide"
      >
        <i
          className="fa-brands fa-github"
          style={{ marginInlineStart: 10, fontSize: 24, color: "white" }}
        />
      </a>
      <div style={{ flexGrow: 1 }} />
      {auth ? (
        <AuthControls />
      ) : (
        <span style={{ marginInline: 16, fontSize: 13 }}>
          שמירה מקומית בדפדפן
        </span>
      )}
    </div>
  )
}

const AuthControls = () => {
  const [currentUser, loading] = useAuthState(auth!)
  const [busy, setBusy] = useState(false)
  const authenticate = async (signingOut = false) => {
    setBusy(true)
    try {
      if (signingOut) await signOut(auth!)
      else await signInWithPopup(auth!, google)
    } catch (error) {
      const code = (error as { code?: string }).code
      if (
        code !== "auth/popup-closed-by-user" &&
        code !== "auth/cancelled-popup-request"
      ) {
        notifications.show({
          title: "ההתחברות לגוגל לא הושלמה",
          message:
            code === "auth/popup-blocked"
              ? "אפשרו חלונות קופצים עבור האתר ונסו שוב."
              : code === "auth/unauthorized-domain"
                ? "הכתובת הזו עדיין אינה מוגדרת להתחברות לגוגל. אפשר להמשיך לשמור מקומית."
                : "לא ניתן להתחבר כרגע. נסו שוב מאוחר יותר.",
          color: "red",
        })
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {(currentUser === null || currentUser === undefined) && (
        <Button
          mx="xs"
          variant="white"
          leftSection={<i className="fa-solid fa-sign-in" />}
          loading={loading || busy}
          onClick={() => authenticate()}
        >
          התחבר/י
        </Button>
      )}
      {currentUser !== null && currentUser !== undefined && (
        <>
          <p style={{ display: "flex", alignItems: "center" }}>
            שלום,{" "}
            <b style={{ marginInlineStart: 5 }}>{currentUser.displayName}</b>
            {currentUser.photoURL !== null && (
              <img
                src={currentUser.photoURL}
                height={30}
                style={{ borderRadius: "50%", marginInlineStart: 5 }}
              />
            )}
          </p>
          <Button
            mx="xs"
            variant="white"
            leftSection={<i className="fa-solid fa-sign-out" />}
            loading={busy}
            onClick={() => authenticate(true)}
          >
            התנתק/י
          </Button>
        </>
      )}
    </>
  )
}

export default Header
