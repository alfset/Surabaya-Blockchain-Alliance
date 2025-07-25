import { useState, useEffect, useRef } from "react";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db, auth } from "../../../../config";
import { Transaction, ForgeScript, BrowserWallet } from "@meshsdk/core";
import { useRouter } from "next/router";
import { FaCheckCircle, FaEllipsisH, FaEye, FaWallet } from "react-icons/fa";
import html2canvas from "html2canvas";
import domtoimage from "dom-to-image";
import { uploadFile } from "@/utils/upload";
import LoadingScreen from "@/components/loading-screen";
import AlertMessage from "@/components/alert-message";
import NFTCertificate from "@/components/tickets/nft";
import CertModal from "@/components/tickets/certificate";
import GlowingRings from "@/components/animated/glowing";

const policyId = "a727399922a075addd9d2ea1b494feb2b774f721d988e48b92fa89d2";

const validateMetadataLength = (metadata) => {
  const checkLength = (value, field) => {
    if (typeof value === "string" && Buffer.from(value).length > 64) {
      throw new Error(
        `Metadata field '${field}' is too long: ${value} (${Buffer.from(value).length} bytes, max 64)`
      );
    }
  };
  const traverse = (obj, path = "") => {
    for (const [key, value] of Object.entries(obj)) {
      const newPath = path ? `${path}.${key}` : key;
      if (typeof value === "string") {
        checkLength(value, newPath);
      } else if (typeof value === "object" && value !== null) {
        traverse(value, newPath);
      }
    }
  };
  traverse(metadata);
};

export default function ClaimNFTPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [event, setEvent] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [certificateCid, setCertificateCid] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [walletAddress, setWalletAddress] = useState(null);
  const [wallets, setWallets] = useState([]);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const router = useRouter();
  const { id } = router.query;
  const certificateRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((firebaseUser) => {
      if (!firebaseUser && id) {
        router.push("/signin");
      } else {
        fetchData(firebaseUser);
        fetchWallets();
      }
    });
    return () => unsubscribe();
  }, [id]);

  const generateProof = (length = 16) => {
  const chars = "abcdefZJHJDHKJ87676753250123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};


  const fetchWallets = async () => {
    try {
      const availableWallets = await BrowserWallet.getAvailableWallets();
      setWallets(availableWallets);
      if (availableWallets.length === 0) {
        setStatus("⚠️ No Cardano wallets found. Please install a wallet like Nami or Eternl.");
      }
    } catch (error) {
      console.error("Error fetching wallets:", error);
      setStatus("❌ Failed to fetch wallets.");
    }
  };

  const fetchData = async (user) => {
    if (!id || !user) return;

    try {
      setLoading(true);
      const joinDocRef = doc(db, `nft-images/${id}/joined`, user.uid);
      const joinDocSnap = await getDoc(joinDocRef);
      if (!joinDocSnap.exists() || !joinDocSnap.data().nftClaimEligible) {
        setStatus("Not eligible to claim NFT");
        setLoading(false);
        return;
      }

      const joinData = joinDocSnap.data();
      setMetadata(joinData.metadata || {});

      const eventDocRef = doc(db, "nft-images", id);
      const eventSnap = await getDoc(eventDocRef);
      if (!eventSnap.exists()) {
        setStatus("Event not found");
        setLoading(false);
        return;
      }
      setEvent(eventSnap.data());

      setLoading(false);
    } catch (error) {
      console.error("Error fetching data:", error);
      setError(error.message);
      setLoading(false);
    }
  };

  const handleWalletSelect = async (walletId) => {
    setShowWalletModal(false);
    try {
      const selectedWallet = await BrowserWallet.enable(walletId);
      const address = await selectedWallet.getChangeAddress();
      setWallet(selectedWallet);
      setWalletAddress(address);
      setStatus("✅ Wallet connected.");
    } catch (error) {
      console.error("Wallet connection error:", error);
      setStatus("❌ Failed to connect wallet.");
    }
  };

  const generateCertificateImage = async () => {
    if (!certificateRef.current) return null;

    try {
      const canvas = await html2canvas(certificateRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        ignoreElements: (el) => {
          const style = getComputedStyle(el);
          return [...style].some(prop => style.getPropertyValue(prop).includes("oklch"));
        }
      });

      const image = canvas.toDataURL("image/png");
      const response = await fetch(image);
      const blob = await response.blob();
      const file = new File([blob], "certificate.png", { type: "image/png" });
      const { gatewayUrl } = await uploadFile(file);
      return gatewayUrl;

    } catch (html2canvasError) {
      console.warn("html2canvas failed, falling back to dom-to-image:", html2canvasError);
      try {
        const image = await domtoimage.toPng(certificateRef.current, {
          quality: 1,
          width: certificateRef.current.offsetWidth * 2,
          height: certificateRef.current.offsetHeight * 2,
          style: {
            backgroundColor: '#fff',
          }
        });

        const response = await fetch(image);
        const blob = await response.blob();
        const file = new File([blob], "certificate.png", { type: "image/png" });
        const { gatewayUrl } = await uploadFile(file);
        return gatewayUrl;

      } catch (fallbackError) {
        console.error("Both html2canvas and dom-to-image failed:", fallbackError);
        throw new Error("Failed to generate certificate image");
      }
    }
  };

  const handleClaimNFT = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        setStatus("❌ User not authenticated.");
        return;
      }
      if (!wallet || !walletAddress) {
        setStatus("❌ Please connect your wallet.");
        setShowWalletModal(true);
        return;
      }

      const joinDocRef = doc(db, `nft-images/${id}/joined`, user.uid);
      const joinDocSnap = await getDoc(joinDocRef);
      if (!joinDocSnap.exists() || !joinDocSnap.data().nftClaimEligible) {
        setStatus("❌ Not eligible to claim NFT.");
        return;
      }

      setStatus("⏳ Generating certificate image...");
      setLoading(true);
      const certCid = await generateCertificateImage();
      if (!certCid) {
        throw new Error("Failed to generate certificate image");
      }
      setCertificateCid(certCid);

      const balance = await wallet.getBalance();
      const lovelace = balance.find((asset) => asset.unit === "lovelace")?.quantity || "0";
      if (parseInt(lovelace) < 2_000_000) {
        throw new Error("Insufficient balance. At least 2 ADA required.");
      }

      const certificateMetadata = {
        certificateName: `Participation Certificate for ${event.title}`,
        username: metadata.username || "Anonymous",
        eventHeld: new Date(event.time).toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: event.timezone || "UTC",
        }),
        role: "peserta",
        attestation: metadata.attestation || "N/A",
        merkleTreeProof: metadata.merkleTreeProof || "N/A",
      };

      const assetName = event.assetName || `Certificate-${Date.now()}`;
      const txMetadata = {
        721: {
          [policyId]: {
            [assetName]: {
              name: event.title.slice(0, 64),
              description: event.description.slice(0, 64),
              image: certCid.slice(0, 64),
              mediaType: "image/png",
              ...certificateMetadata,
            },
          },
        },
      };

      validateMetadataLength(txMetadata);

      const tx = new Transaction({ initiator: wallet });
      tx.mintAsset(ForgeScript.withOneSignature(walletAddress), {
        assetName,
        assetQuantity: "1",
        metadata: txMetadata,
        label: "721",
        recipient: walletAddress,
      });

      setStatus("⏳ Building transaction...");
      const unsignedTx = await tx.build();
      setStatus("✍️ Signing transaction...");
      const signedTx = await wallet.signTx(unsignedTx);
      setStatus("📤 Submitting transaction...");
      const txHash = await wallet.submitTx(signedTx);

      // Removed the 30-second wait; directly show success message
      const txLink = `https://cexplorer.io/tx/${txHash}`;
      const shortTxHash = `${txHash.slice(0, 6)}...${txHash.slice(-4)}`;
      setStatus(`✅ NFT claimed successfully! ${shortTxHash} View Transaction: ${txLink}`);

      await updateDoc(joinDocRef, { nftClaimed: true, nftClaimTxHash: txHash });

    } catch (error) {
      console.error("Error claiming NFT:", error);
      setStatus(`❌ Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    const element = certificateRef.current;
    if (!element) {
      console.error("No content to print.");
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      console.error("Failed to open print window.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(`
      <html>
        <head>
          <title>Print Certificate</title>
          <style>
            @media print {
              body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            }
            body {
              margin: 0;
              padding: 20px;
              font-family: Arial, sans-serif;
            }
          </style>
        </head>
        <body>
          ${element.outerHTML}
        </body>
      </html>
    `);
    printWindow.document.close();

    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    };
  };

  if (loading) {
    return <LoadingScreen />;
  }

  if (error || !event || !metadata) {
    return (
      <section className="relative min-h-screen flex flex-col bg-gray-100 text-black overflow-hidden">
        <div className="flex-grow flex items-center justify-center p-6">
          <div className="max-w-4xl w-full bg-red-100 text-red-700 p-6 rounded-lg shadow-md text-center">
            <span>{error || "Event not found."}</span>
          </div>
        </div>
      </section>
    );
  }

  const prefix = metadata.attestation.split('-')[1];

  return (
    <section className="min-h-screen flex flex-col justify-start py-20 px-60 text-black bg-white">
      <GlowingRings />
      {status && (
        <div className="px-10 mb-6">
          <AlertMessage message={status} />
        </div>
      )}
      <div className="flex flex-col w-full space-y-6 z-10">
        <div className="flex justify-between items-start w-full">
          <div>
            <h1 className="text-5xl font-extrabold">Congratulations 🏆</h1>
            <p className="text-lg font-normal mt-2">
              You completed event <strong>{event.title}</strong>, claim your NFT below.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowWalletModal(true)}
              className="btn border border-black text-white bg-gray-700 hover:bg-black hover:text-white flex items-center justify-center gap-2"
              disabled={loading}
            >
              <FaWallet />
              <span className="pt-1">
                {walletAddress
                  ? `${walletAddress.slice(0, 10)}...${walletAddress.slice(-10)}`
                  : "Connect Wallet"}
              </span>
            </button>
            <div className="dropdown dropdown-hover dropdown-end text-black">
              <div tabIndex={0} role="button" className="btn m-1 bg-transparent hover:bg-transparent"><FaEllipsisH /></div>
              {certificateCid && (
                <ul tabIndex={0} className="dropdown-content menu bg-base-100 rounded-box z-1 w-52 p-2 shadow-sm">
                  <li><button onClick={() => setOpen(true)}><FaEye /> Preview</button></li>
                </ul>
              )}
            </div>
          </div>
        </div>

        <NFTCertificate
          ref={certificateRef}
          title={event.title}
          image={"/img/logo.png"}
          description={event.description}
          username={metadata.username || "Anonymous"}
          date={new Date(event.time).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: event.timezone || "UTC" })}
          eventId={prefix}
          organizer={"Cardano Hub Indonesia"} />

        <button
          className={`mx-auto py-3 w-full rounded-lg px-14 text-xl font-bold uppercase text-white transition focus:outline-none focus:ring-4 focus:ring-purple-300
            ${walletAddress
              ? 'cursor-pointer bg-gradient-to-r from-slate-700 to-blue-700 hover:bg-gradient-to-br'
              : 'cursor-not-allowed bg-gray-400'
            }`}
          onClick={handleClaimNFT}
          disabled={!walletAddress || loading}
          aria-label="Claim NFT button"
        >
          <span className="pt-2">{loading ? <span className="loading loading-dots loading-lg"></span> : '🏆 Claim NFT'}</span>
        </button>

        {status.startsWith("✅") && (
          <div className="flex items-center justify-center mt-8 space-x-2 text-green-600">
            <FaCheckCircle size={24} />
            <span className="font-semibold text-lg">{status}</span>
          </div>
        )}

        <CertModal
          isOpen={open}
          onClose={() => setOpen(false)}
          handlePrint={handlePrint}
          imageUrl={certificateCid}
          metadata={"Certificate Image"} />

        {showWalletModal && (
          <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center">
            <div className="bg-white p-6 rounded-lg shadow-xl text-center space-y-4 max-w-md w-full">
              <h2 className="text-xl font-bold">Select a Wallet</h2>
              {wallets.map((wallet) => (
                <button
                  key={wallet.id}
                  onClick={() => handleWalletSelect(wallet.id)}
                  className="btn w-full my-2"
                >
                  {wallet.name}
                </button>
              ))}
              <button
                onClick={() => setShowWalletModal(false)}
                className="btn btn-ghost mt-4"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
