import { Button } from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { useState } from "react"
import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth"
import { useAuthState } from "react-firebase-hooks/auth"
import { auth } from "../firebase"
import GoogleScheduleSync from "./GoogleScheduleSync"

const google = new GoogleAuthProvider()

const Header = () => {
  return (
    <div
      id="header"
      className="dont-print"
      style={{
        backgroundColor: "var(--mantine-color-body)",
        borderBottom: "1px solid var(--mantine-color-default-border)",
        color: "var(--mantine-color-text)",
        width: "100%",
        height: 75,
        flex: "none",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      <a
        href="/"
        aria-label="דיביט של נועם"
        style={{ color: "var(--mantine-color-text)", marginInline: 12 }}
      >
        <i
          className="fa-solid fa-calendar-days"
          style={{ fontSize: 28 }}
          aria-hidden="true"
        />
      </a>
      <h3 style={{ fontWeight: "bold", fontSize: "1em", lineHeight: 1.3 }}>
        דיביט של נועם
      </h3>
      <a
        href="https://github.com/noam-isaac/dib-it"
        aria-label="קוד המקור של דיביט של נועם בגיטהאב"
        className="link show-wide"
      >
        <i
          className="fa-brands fa-github"
          style={{
            marginInlineStart: 10,
            fontSize: 24,
            color: "var(--mantine-color-text)",
          }}
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
          variant="default"
          leftSection={<i className="fa-solid fa-sign-in" />}
          loading={loading || busy}
          onClick={() => authenticate()}
        >
          התחבר/י
        </Button>
      )}
      {currentUser !== null && currentUser !== undefined && (
        <>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              minWidth: 0,
            }}
          >
            <p style={{ display: "flex", alignItems: "center", margin: 0 }}>
              <span className="show-wide">שלום,&nbsp;</span>
              <b
                title={currentUser.displayName ?? undefined}
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {currentUser.displayName}
              </b>
              {currentUser.photoURL !== null && (
                <img
                  src={currentUser.photoURL}
                  alt=""
                  width={30}
                  height={30}
                  style={{
                    borderRadius: "50%",
                    marginInlineStart: 5,
                    flexShrink: 0,
                  }}
                />
              )}
            </p>
            <GoogleScheduleSync />
          </div>
          <Button
            mx="xs"
            variant="default"
            style={{ flexShrink: 0 }}
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
