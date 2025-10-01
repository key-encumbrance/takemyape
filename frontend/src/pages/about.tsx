import Head from "next/head";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";

export default function About() {
  const currentYear = new Date().getFullYear();

  return (
    <div className="main-container">
      <Head>
        <title>What is Liquefaction? | Take My Ape</title>
        <meta
          name="description"
          content="Learn about liquefaction - a revolutionary approach for temporary NFT control without transferring ownership."
        />
      </Head>

      <header>
        <div className="brand">
          <Link href="/">Take My Ape</Link>
        </div>
        <div className="header-right">
          <nav className="main-nav">
            <Link href="/about" className="nav-link active">
              What is Liquefaction?
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
          <h1>Understanding Liquefaction</h1>
          <p>
            Liquefaction introduces a revolutionary approach to digital asset
            control, allowing owners to delegate access without transferring
            ownership.
          </p>
        </div>
      </section>

      <section className="about-content">
        <div className="about-content-inner">
          <div className="description-box">
            <h2>What is Liquefaction?</h2>
            <p>
              Liquefaction is a wallet platform that uses trusted execution
              environments (TEEs) to enforce fine-grained access-control
              policies on private keys. By encumbering keys with programmable
              rules, it allows assets to be shared, rented, or pooled while
              preserving privacy and leaving no on-chain traces.
            </p>
          </div>

          <div className="key-concepts">
            <h2>Key Concepts</h2>
            <ul className="key-concepts-list">
              <li className="key-concept-item">
                <p>
                  <strong>Encumbered Key →</strong> The system generates a key
                  pair inside a Trusted Execution Environment (TEE). We call
                  this the "encumbered key", as it is not accessible to anyone,
                  not even the creator.
                </p>
              </li>
              <li className="key-concept-item">
                <p>
                  <strong>Access Control →</strong> Smart contracts define the
                  rules and limitations for the encumbered key, including
                  Time-based restrictions (e.g., 2-minute usage windows) or
                  Action limitations (e.g., only allow transfers to specific
                  addresses).
                </p>
              </li>
              <li className="key-concept-item">
                <p>
                  <strong>Asset Segmentation →</strong> You can define access
                  control mechanisms on a per-asset basis, allowing for two
                  people to have exclusive access to different assets that lay
                  in the same wallet.
                </p>
              </li>
              <li className="key-concept-item">
                <p>
                  <strong>Many Applications →</strong> This simple construction
                  has many applications, from the creation of fully private
                  mixers, to the use of Oasis as a Bitcoin L2 and even Locked
                  token trading! You can find all the applications of
                  Liquefaction below.
                </p>
              </li>
            </ul>
          </div>

          <div className="description-box">
            <h2>Applications of Liquefaction</h2>
            <div className="applications-grid">
              <div className="application-category">
                <h3>Governance</h3>
                <div className="application-card">
                  <h4>Voting</h4>
                  <p>
                    Enable private DAOs to operate within public DAOs, allowing
                    for dark DAO voting systems with private delegation
                    capabilities.
                  </p>
                </div>
                <div className="application-card">
                  <h4>Quadratic Voting</h4>
                  <p>
                    Distribute voting power across multiple accounts while
                    maintaining identity systems integrity.
                  </p>
                </div>
                <div className="application-card">
                  <h4>Multisigs</h4>
                  <p>
                    Enable selling access to key participation in multisig
                    structures with enhanced privacy.
                  </p>
                </div>
              </div>

              <div className="application-category">
                <h3>Reputation</h3>
                <div className="application-card">
                  <h4>Soulbound Tokens</h4>
                  <p>
                    Allow temporary renting of non-transferable NFT proofs while
                    maintaining core ownership.
                  </p>
                </div>
                <div className="application-card">
                  <h4>Transaction History</h4>
                  <p>
                    Enable purchasing accounts with specific transaction
                    histories for exchange requirements.
                  </p>
                </div>
                <div className="application-card">
                  <h4>Airdrop Rights</h4>
                  <p>
                    Trade access to accounts that may be eligible for future
                    airdrops.
                  </p>
                </div>
                <div className="application-card">
                  <h4>Loyalty Points</h4>
                  <p>
                    Split rewards across multiple accounts while maintaining
                    account integrity.
                  </p>
                </div>
                <div className="application-card">
                  <h4>Wash Trading</h4>
                  <p>
                    Create less traceable trading between seemingly unconnected
                    accounts.
                  </p>
                </div>
              </div>

              <div className="application-category">
                <h3>Privacy</h3>
                <div className="application-card">
                  <h4>Trading Locked Tokens</h4>
                  <p>
                    Trade locked tokens and bypass transfer restrictions while
                    maintaining ownership rules.
                  </p>
                </div>
                <div className="application-card">
                  <h4>Private Asset Trading</h4>
                  <p>
                    Execute trades across multiple user wallets without on-chain
                    transactions.
                  </p>
                </div>
                <div className="application-card">
                  <h4>Private DAO Treasuries</h4>
                  <p>
                    Enable raising and storing funds in a decentralized, private
                    manner.
                  </p>
                </div>
                <div className="application-card">
                  <h4>Secret Contract Payments</h4>
                  <p>
                    Pay bounties by revealing secret keys of encumbered wallets.
                  </p>
                </div>
                <div className="application-card">
                  <h4>Hidden Privacy Pools</h4>
                  <p>
                    Create Dark DAOs that enforce inclusion through
                    association-set proofs.
                  </p>
                </div>
              </div>

              <div className="application-category">
                <h3>Ticketing</h3>
                <div className="application-card">
                  <h4>Token-Gated Ticketing</h4>
                  <p>
                    Transfer event or metaverse access to users without
                    transferring the underlying asset.
                  </p>
                </div>
              </div>

              <div className="application-category">
                <h3>Provenance</h3>
                <div className="application-card">
                  <h4>Faking Theft</h4>
                  <p>
                    Simulate asset theft by secretly maintaining access to
                    transferred funds.
                  </p>
                </div>
                <div className="application-card">
                  <h4>Dusting Attack Mitigation</h4>
                  <p>
                    Prove that unsolicited token deposits haven't assumed
                    control of assets.
                  </p>
                </div>
              </div>

              <div className="application-category">
                <h3>Cross-chain</h3>
                <div className="application-card">
                  <h4>Overlay Smart Contracts</h4>
                  <p>
                    Treat encumbered addresses as smart contract interfaces
                    across different blockchains.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="description-box">
            <div className="disclaimer">
              <p>
                Note: While liquefaction enables many powerful applications,
                some uses may have adversarial implications. It's important to
                understand both the constructive use cases and potential misuse
                scenarios.
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
