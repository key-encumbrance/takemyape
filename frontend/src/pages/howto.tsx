import Head from "next/head";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";

export default function HowTo() {
  const currentYear = new Date().getFullYear();

  return (
    <div className="main-container">
      <Head>
        <title>How To Use | Take My Ape</title>
        <meta
          name="description"
          content="Learn how to use Take My Ape with our step-by-step video tutorials."
        />
      </Head>

      <header>
        <div className="brand">
          <Link href="/">Take My Ape</Link>
        </div>
        <div className="header-right">
          <nav className="main-nav">
            <Link href="/about" className="nav-link">
              What is Liquefaction?
            </Link>
            <Link href="/howto" className="nav-link active">
              How To Use
            </Link>
            <a
              href="https://arxiv.org/pdf/2412.02634"
              target="_blank"
              rel="noopener noreferrer"
              className="nav-link"
            >
              Research Paper
            </a>
          </nav>
          <ConnectButton />
        </div>
      </header>

      <section className="about-hero-section">
        <div className="about-hero-content">
          <h1>How To Use Take My Ape</h1>
          <p>
            Watch our step-by-step video tutorials to learn how to get started
            with Take My Ape and make the most of its features.
          </p>
        </div>
      </section>

      <section className="about-content">
        <div className="about-content-inner">
          <div className="description-box">
            <h2>Getting Started</h2>
            <div className="video-container">
              <h3>How to Get the Ape</h3>
              <video
                controls
                width="100%"
                className="tutorial-video"
                poster="/videos/How_to_get_the_ape.mp4"
              >
                <source src="/videos/How_to_get_the_ape.mp4" type="video/mp4" />
                Your browser does not support the video tag.
              </video>
              <p className="video-description">
                Learn how to connect your wallet and get started with your first
                Ape NFT.
              </p>
            </div>
          </div>

          <div className="description-box">
            <h2>Using the Platform</h2>
            <div className="video-container">
              <h3>What You Can Do With the Ape</h3>
              <video
                controls
                width="100%"
                className="tutorial-video"
                poster="/videos/what_you_can_do_with_the_ape.mp4"
              >
                <source
                  src="/videos/what_you_can_do_with_the_ape.mp4"
                  type="video/mp4"
                />
                Your browser does not support the video tag.
              </video>
              <p className="video-description">
                Discover all the features and capabilities available with your
                Ape NFT.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div>
          <p>© {currentYear} Take My Ape. All rights reserved.</p>
          <div className="links">
            <Link href="/about">What is Liquefaction?</Link>
            <Link href="/howto">How To Use</Link>
            <a
              href="https://arxiv.org/pdf/2412.02634"
              target="_blank"
              rel="noopener noreferrer"
            >
              Research Paper
            </a>
            <a
              href="https://github.com/key-encumbrance/liquefaction"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
