import ForkIntro from "./ForkIntro"

const Footer = () => {
  return (
    <footer
      style={{
        textAlign: "center",
        width: "100%",
        backgroundColor: "var(--mantine-color-body)",
        color: "var(--mantine-color-dimmed)",
        borderTop: "1px solid var(--mantine-color-default-border)",
      }}
      className="footer dont-print"
    >
      <p style={{ margin: "7px" }}>
        דיביט של נועם · מבוסס על{" "}
        <a className="link text-accent" href="https://github.com/arazimproject/dib-it">Dib It של ארזים</a>
        {" · "}<ForkIntro />
        {" · "}<a className="link text-accent" href="https://github.com/noam-isaac/dib-it/issues">משוב</a>
        {" · "}<a className="link text-accent" href="https://github.com/noam-isaac/dib-it/blob/main/LICENSE.md">© Arazim Project · MIT</a>
      </p>
    </footer>
  )
}

export default Footer
