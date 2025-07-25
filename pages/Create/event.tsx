import { useState, useEffect } from "react";
import { getAssetInfoFromTx, getAssetOwner } from "@/utils/indexing";
import { BrowserWallet, Transaction, ForgeScript } from "@meshsdk/core";
import { uploadFile } from "../../utils/upload";
import { FaCalendarCheck, FaGoogle, FaVideo, FaWallet, FaTwitter } from "react-icons/fa";
import Link from "next/link";
import Select from "react-select";
import { auth, db } from "../../config";
import { doc, setDoc } from "firebase/firestore";
import { useRouter } from "next/router";
import { v4 as uuidv4 } from "uuid";
import ImageWithFallback from "@/components/image-fallback";
import LoadingScreen from "@/components/loading-screen";
import AlertMessage from "@/components/alert-message";
import TagsInput from "@/components/tags";
import { getAuth, signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import axios from "axios";

const timezones = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "Eastern Time (US)" },
  { value: "America/Los_Angeles", label: "Pacific Time (US)" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Asia/Jakarta", label: "Jakarta (WIB)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Australia/Sydney", label: "Sydney (AEST/AEDT)" },
];

const paymentRecipient =
  process.env.PAYMENT_RECIPIENT_ADDRESS ||
  "addr_test1qzf333svyuyxrt8aajhgjmews0737sf69uvn4xyt4ny2ent88fhr8q5eqrdqfhaqcu4fcd2hqfz6fw4h57jlgzfp6rlsvj37jm";
const policyId = "a727399922a075addd9d2ea1b494feb2b774f721d988e48b92fa89d2";

const SCOPES = ['https://www.googleapis.com/auth/meetings.space.created'];

const stringToHex = (str) =>
  [...str].map((c) => ("0" + c.charCodeAt(0).toString(16)).slice(-2)).join("");

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

export default function MintNFTPage() {
  const [form, setForm] = useState({
    name: "",
    image: "",
    fee: "",
    date: "",
    time: "",
    description: "",
    tags: "",
    meetLink: "",
    platform: "gmeet",
    timezone: "UTC",
  });
  const [wallet, setWallet] = useState(null);
  const [walletAddress, setWalletAddress] = useState(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [wallets, setWallets] = useState([]);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [uploadInfo, setUploadInfo] = useState({ cid: "", ipfsUrl: "", gatewayUrl: "" });
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const router = useRouter();

  const platformOptions = [
    {
      value: "gmeet",
      label: "Google Meet",
      icon: (
        <svg height="20" viewBox="0 0 48 48" width="20" xmlns="http://www.w3.org/2000/svg">
          <rect fill="#fff" height="16" transform="rotate(-90 20 24)" width="16" x="12" y="16" />
          <polygon fill="#1e88e5" points="3,17 3,31 8,32 13,31 13,17 8,16" />
          <path d="M37,24v14c0,1.657-1.343,3-3,3H13l-1-5l1-5h14v-7l5-1L37,24z" fill="#4caf50" />
          <path d="M37,10v14H27v-7H13l-1-5l1-5h21C35.657,7,37,8.343,37,10z" fill="#fbc02d" />
          <path d="M13,31v10H6c-1.657,0-3-1.343-3-3v-7H13z" fill="#1565c0" />
          <polygon fill="#e53935" points="13,7 13,17 3,17" />
          <polygon fill="#2e7d32" points="38,24 37,32.45 27,24 37,15.55" />
          <path d="M46,10.11v27.78c0,0.84-0.98,1.31-1.63,0.78L37,32.45v-16.9l7.37-6.22C45.02,8.8,46,9.27,46,10.11z" fill="#4caf50" />
        </svg>
      ),
    },
    {
      value: "youtube",
      label: "YouTube",
      icon: <FaVideo className="text-red-600" />,
    },
    {
      value: "twitter",
      label: "Twitter Space",
      icon: <FaTwitter className="text-black" />,
    },
  ];

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        const providerData = firebaseUser.providerData.find(
          (provider) => provider.providerId === GoogleAuthProvider.PROVIDER_ID
        );
        if (!providerData && form.platform === "gmeet") {
          setStatus("⚠️ Please sign in with Google to create Google Meet links.");
        }
      } else {
        router.push("/signin");
      }
      setCheckingAuth(false);
    });

    return () => unsubscribe();
  }, [router, form.platform]);

  useEffect(() => {
    if (!user) return;

    const fetchWallets = async () => {
      try {
        const availableWallets = await BrowserWallet.getAvailableWallets();
        setWallets(availableWallets);
        if (availableWallets.length === 0) {
          alert("No Cardano wallets found. Please install a wallet like Nami or Eternl.");
        } else {
          setShowWalletModal(true);
        }
      } catch (error) {
        console.error("Error fetching wallets:", error);
        setStatus("❌ Failed to fetch wallets.");
      }
    };
    fetchWallets();
  }, [user]);

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

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setStatus("⏳ Uploading image...");

    try {
      const { cid, ipfsUrl } = await uploadFile(file);
      const pinataGatewayUrl = `https://sapphire-managing-narwhal-834.mypinata.cloud/ipfs/${cid}`;
      setForm({ ...form, image: pinataGatewayUrl });
      setUploadInfo({ cid, ipfsUrl, gatewayUrl: pinataGatewayUrl });
      setStatus("✅ Image uploaded successfully.");
    } catch (error) {
      console.error("Image upload error:", error);
      setStatus(`❌ Failed to upload image: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTagsChange = (tags) => {
    let tagsArray = [];
    if (Array.isArray(tags)) {
      tagsArray = tags;
    } else if (typeof tags === "string") {
      tagsArray = tags.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
    }
    setForm((prev) => ({ ...prev, tags: tagsArray.join(",") }));
    console.log("Tags:", form.tags);
  };

  const handleSignInWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope(SCOPES.join(" "));
      const result = await signInWithPopup(auth, provider);
      setUser(result.user);
      setStatus("✅ Signed in with Google. Please generate the Google Meet link.");
    } catch (error) {
      console.error("Google sign-in error:", error);
      setStatus(`❌ Failed to sign in with Google: ${error.message}`);
    }
  };

  const generateMeetLink = async () => {
    if (form.platform !== "gmeet") {
      const randomKey = Math.random().toString(36).substring(2, 10);
      let meetLink = "";
      switch (form.platform) {
        case "youtube":
          meetLink = `https://youtube.com/watch?v=${randomKey}`;
          break;
        case "twitter":
          meetLink = `https://x.com/i/spaces/${randomKey}`;
          break;
        default:
          return;
      }
      setForm((prev) => ({ ...prev, meetLink }));
      setStatus("✅ Meeting link generated.");
      return;
    }

    if (!user) {
      setStatus("❌ User not authenticated. Please sign in.");
      return;
    }

    if (!form.date || !form.time) {
      setStatus("❌ Please provide both date and time for the event.");
      return;
    }

    try {
      setLoading(true);
      setStatus("⏳ Redirecting to Google OAuth...");

      const clientId = "69379032730-q8vsfifc8esnh1njvahbiavefhltugha.apps.googleusercontent.com";
      const redirectUri = process.env.NEXT_BASE_URL
        ? `${process.env.NEXT_BASE_URL}/Create/event`
        : "http://localhost:3000/Create/event";
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${clientId}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent(SCOPES.join(" "))}&` +
        `access_type=offline&` +
        `prompt=consent`;

      window.location.href = authUrl;
    } catch (error) {
      console.error("Error initiating Google OAuth:", error);
      setStatus(`❌ Failed to initiate Google OAuth: ${error.message}`);
    }
  };

  useEffect(() => {
    const handleOAuthCallback = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get("code");
      if (code) {
        try {
          setLoading(true);
          setStatus("⏳ Processing OAuth callback...");

          const response = await axios.post(
            "/api/create-meet-space",
            { code },
            {
              headers: { "Content-Type": "application/json" },
            }
          );
          const meetLink = response.data.meetLink;
          if (!meetLink) {
            throw new Error("Failed to generate Google Meet link.");
          }

          setForm((prev) => ({ ...prev, meetLink }));
          setStatus("✅ Google Meet link generated successfully.");
          router.replace(router.pathname, undefined, { shallow: true });
        } catch (error) {
          console.error("Error processing OAuth callback:", error);
          setStatus(
            `❌ Failed to process OAuth callback: ${
              error.response?.data?.error || error.message
            }`
          );
        } finally {
          setLoading(false);
        }
      }
    };

    handleOAuthCallback();
  }, [router]);

const handleSignMinter = async () => {
    if (!user) {
      setStatus("❌ User not authenticated. Please sign in.");
      return;
    }
    if (!wallet || !walletAddress) {
      setStatus("❌ Wallet not connected.");
      return;
    }
    if (!form.image || !uploadInfo.cid) {
      setStatus("❌ Please upload an image.");
      return;
    }
    if (!form.name) {
      setStatus("❌ Please provide an event name.");
      return;
    }
    if (!form.date || !form.time) {
      setStatus("❌ Please provide both date and time for the event.");
      return;
    }
    if (!form.meetLink) {
      setStatus("❌ Please provide a meeting link.");
      return;
    }
    if (
      (form.platform === "gmeet" && !form.meetLink.startsWith("https://meet.google.com/")) ||
      (form.platform === "zoom" && !form.meetLink.startsWith("https://zoom.us/j/"))
    ) {
      setStatus(
        `❌ Invalid ${form.platform === "gmeet" ? "Google Meet" : "Zoom"} link format.`
      );
      return;
    }

    try {
      setLoading(true);
      setStatus("⏳ Preparing transaction...");
      const balance = await wallet.getBalance();
      const lovelace = balance.find((asset) => asset.unit === "lovelace")?.quantity || "0";
      if (parseInt(lovelace) < 1_000_000) {
        throw new Error("Insufficient balance. You need at least 1 ADA to mint an event NFT.");
      }
      const usedAddresses = await wallet.getUsedAddresses();
      const address = usedAddresses[0] || walletAddress;
      const assetName = stringToHex(form.name || `EventNFT-${Date.now()}`);
      const eventDateTime = `${form.date}T${form.time}:00`;
      const metadata = {
        721: {
          [policyId]: {
            [assetName]: {
              name: form.name.slice(0, 64) || "Event NFT",
              description: form.description.slice(0, 64) || "An event NFT on Cardano",
              image: uploadInfo.cid.slice(0, 64),
              mediaType: "image/jpeg",
              creator: user.uid,
              eventDateTime,
              meetLink: form.meetLink.slice(0, 64) || "",
              timezone: form.timezone,
              tags: form.tags
                ? form.tags.split(",").map((tag) => tag.trim().slice(0, 64)).slice(0, 10)
                : ["event", "NFT", "cardano"],
            },
          },
        },
      };

      validateMetadataLength(metadata);
      const tx = new Transaction({ initiator: wallet });
      tx.mintAsset(ForgeScript.withOneSignature(walletAddress), {
        assetName,
        assetQuantity: "1",
        metadata,
        label: "721",
        recipient: address,
      });
      const unsignedTx = await tx.build();
      const signedTx = await wallet.signTx(unsignedTx);
      const txHash = await wallet.submitTx(signedTx);

      await new Promise((resolve) => setTimeout(resolve, 30000));

      const assetInfos = await getAssetInfoFromTx(txHash);
      if (!assetInfos || assetInfos.length === 0) {
        throw new Error("Unable to retrieve asset info from transaction.");
      }

      const asset = assetInfos[0];
      const assetOwner = await getAssetOwner(`${asset.policyId}${Buffer.from(asset.assetName).toString("hex")}`);
      if (!assetOwner) {
        throw new Error("Unable to retrieve asset fingerprint.");
      }
      const eventId = uuidv4();
      const nftData = {
        id: eventId,
        creator: address,
        fee: form.fee,
        title: form.name,
        description: form.description,
        image: form.image,
        cid: uploadInfo.cid,
        link: form.meetLink,
        time: eventDateTime,
        timestamp: new Date().toISOString(),
        assetName: form.name,
        policyId: asset.policyId,
      };

      await setDoc(doc(db, "nft-images", eventId), nftData);
      const txLink = `https://preview.cexplorer.io/tx/${txHash}`;
      const shortTxHash = `${txHash.slice(0, 6)}...${txHash.slice(-4)}`;
      setStatus(`✅ Event Created! ${shortTxHash} View Transaction: ${txLink}`);
    } catch (error) {
      console.error("Minting error:", error);
      setStatus(`❌ Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const renderImage = (imageUrl) => {
    if (!imageUrl) {
      return (
        <div className="mt-2 h-32 bg-gray-200 flex items-center justify-center text-gray-600 border rounded">
          <span>No Image Selected</span>
        </div>
      );
    }
    let src = imageUrl;
    if (imageUrl.startsWith("ipfs://")) {
      src = `https://sapphire-managing-narwhal-834.mypinata.cloud/ipfs/${imageUrl.replace(
        "ipfs://",
        ""
      )}`;
    } else if (!imageUrl.startsWith("https://") && !imageUrl.startsWith("data:image/")) {
      src = `https://sapphire-managing-narwhal-834.mypinata.cloud/ipfs/${imageUrl}`;
    }

    return <ImageWithFallback src={src} />;
  };

  if (checkingAuth) {
    return <LoadingScreen />;
  }
  if (!user) {
    return null;
  }

  return (
    <section className="relative min-h-screen flex flex-col text-black overflow-hidden bg-white">
      <div className="flex justify-between gap-10 px-10 sm:px-20 md:px-40">
        <div className="space-y-3 w-full">
          <div className="card bg-base-100 image-full h-96 w-full shadow-none">
            <figure>{form.image && <div className="h-full">{renderImage(form.image)}</div>}</figure>
            <div className="card-body flex flex-col h-full">
              <div className="flex flex-col justify-start items-start space-y-2 mt-auto">
                <div className="space-y-1">
                  <h2 className="card-title gap-3 text-4xl">
                    {form.name || "Event Name Preview"}
                  </h2>
                  <p>{form.description || "Event Description Preview"}</p>
                </div>
                <div className="flex gap-4">
                  {form.date && form.time && (
                    <button className="btn btn-sm btn-outline-primary text-blue-800">
                      <FaCalendarCheck />
                      <span className="pt-1">
                        {new Date(`${form.date}T${form.time}`).toLocaleString("en-US", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: form.timezone || "UTC",
                        })}
                      </span>
                    </button>
                  )}
                  {form.meetLink &&
                    (() => {
                      const platform = platformOptions.find((opt) => opt.value === form.platform);
                      return platform ? (
                        <Link
                          className={`btn btn-sm ${
                            platform.value === "youtube"
                              ? "btn-error"
                              : platform.value === "twitter"
                              ? "btn-black"
                              : "btn-primary"
                          }`}
                          target="_blank"
                          href={form.meetLink}
                        >
                          {platform.icon}
                          <span className="pt-1">{platform.label}</span>
                        </Link>
                      ) : null;
                    })()}
                </div>
              </div>
            </div>
          </div>
          <div className="w-full">
            <button
              onClick={() => setShowWalletModal(true)}
              className="btn border border-black text-white bg-gray-700 hover:bg-black hover:text-white w-full mt-4 flex items-center justify-center gap-2"
              disabled={loading}
            >
              <FaWallet />
              <span className="pt-1">
                {walletAddress
                  ? `${walletAddress.slice(0, 10)}...${walletAddress.slice(-10)}`
                  : "Connect Wallet"}
              </span>
            </button>
            {walletAddress && (
              <button
                onClick={handleSignMinter}
                className="btn bg-blue-600 cursor-pointer text-white border-none hover:bg-blue-800 w-full mt-2"
                disabled={loading}
              >
                {loading ? "Minting..." : "Mint NFT [0 ₳]"}
              </button>
            )}
            {form.platform === "gmeet" && (
              <button
                disabled
                className="btn bg-gray-400 cursor-not-allowed text-white border-none w-full mt-2"
              >
                  Google Meet (Coming Soon)
                </button>
              )}
          </div>
        </div>
        <div className="card w-full mx-auto space-y-6 pb-4">
          {status && <AlertMessage message={status} />}
          <div className="py-4 overflow-y-scroll">
            <h1 className="text-5xl font-bold">
              <span className="text-gray-900">Mint Your</span>{" "}
              <span className="text-green-500">Event NFT</span>
            </h1>
            <p className="text-gray-600 font-medium text-lg">
              Create Event NFTs for your events for a fee of 0 ADA.
            </p>
          </div>
          <div className="space-y-4 text-left">
            <div className="form-control">
              <label className="label text-black capitalize">Event Name</label>
              <input
                type="text"
                name="name"
                placeholder="Enter event name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input input-bordered w-full bg-transparent"
                disabled={loading}
              />
            </div>
            <div className="form-control">
              <label className="label text-black capitalize">
                Event Banner{" "}
                {loading && <span className="loading loading-dots loading-lg"></span>}
              </label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif"
                onChange={handleImageUpload}
                className="file-input file-input-bordered w-full bg-transparent"
                disabled={loading}
              />
            </div>
            <div className="flex justify-between gap-2">
              <div className="form-control w-full">
                <label className="label text-black capitalize">Date</label>
                <input
                  type="date"
                  name="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="input input-bordered w-full bg-transparent"
                  disabled={loading}
                />
              </div>
              <div className="form-control w-full">
                <label className="label text-black capitalize">Time</label>
                <input
                  type="time"
                  name="time"
                  value={form.time}
                  onChange={(e) => setForm({ ...form, time: e.target.value })}
                  className="input input-bordered w-full bg-transparent"
                  disabled={loading}
                />
              </div>
              <div className="form-control w-full">
                <label className="label text-black capitalize">Timezone</label>
                <select
                  name="timezone"
                  value={form.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                  className="select select-bordered w-full bg-transparent"
                  disabled={loading}
                >
                  {timezones.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="form-control">
                <label className="label text-black capitalize">Conference Platform</label>
                <Select
                  options={platformOptions}
                  value={platformOptions.find((opt) => opt.value === form.platform)}
                  onChange={(selected) => setForm({ ...form, platform: selected.value })}
                  isDisabled={loading}
                  formatOptionLabel={({ label, icon }) => (
                    <div className="flex items-center gap-2">
                      {icon}
                      <span className="pt-1">{label}</span>
                    </div>
                  )}
                  className="react-select-container select-lg px-0"
                  classNamePrefix="react-select"
                />
              </div>
              <div className="form-control col-span-2">
                <label className="label text-black capitalize">
                  {platformOptions.find((opt) => opt.value === form.platform)?.label} Link
                </label>
                <input
                  type="url"
                  name="meetLink"
                  placeholder={
                    form.platform === "gmeet"
                      ? "https://meet.google.com/..."
                      : form.platform === "youtube"
                      ? "https://www.youtube.com/watch?v="
                      : "https://x.com/i/spaces/..."
                  }
                  value={form.meetLink}
                  onChange={(e) => setForm({ ...form, meetLink: e.target.value })}
                  className="input input-bordered w-full bg-transparent"
                  disabled={loading || form.platform === "gmeet"}
                />
              </div>
            </div>
            <div className="form-control">
              <label className="label text-black capitalize">Description</label>
              <textarea
                name="description"
                rows={5}
                placeholder="Enter event description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="textarea border-gray-300"
                disabled={loading}
              />
            </div>
            <div className="form-control">
              <label className="label text-black capitalize">Fee</label>
              <input
                type="number"
                name="fee"
                placeholder="Enter fee"
                value={form.fee}
                onChange={(e) => setForm({ ...form, fee: e.target.value })}
                className="input input-bordered w-full bg-transparent"
                disabled={loading}
              />
            </div>
            <TagsInput
              form={{ tags: form.tags }}
              setForm={(updatedForm) => handleTagsChange(updatedForm.tags)}
              loading={loading}
            />
          </div>
        </div>
      </div>
      {showWalletModal && (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center">
          <div className="bg-white p-6 rounded-lg shadow-xl text-center space-y-4 max-w-md w-full">
            <h2 className="text-xl font-bold">Select a Wallet</h2>
            {wallets.map((wallet) => (
              <button
                key={wallet.id}
                className="w-full py-2 border border-black text-black hover:bg-black hover:text-white rounded-md mb-2 flex items-center gap-2 justify-center"
                onClick={() => handleWalletSelect(wallet.id)}
                disabled={loading}
              >
                {wallet.icon && (
                  <img src={wallet.icon} alt={wallet.name} className="w-5 h-5 rounded-sm" />
                )}
                {wallet.name}
              </button>
            ))}
            <button
              onClick={() => setShowWalletModal(false)}
              className="text-sm text-gray-500 hover:underline"
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}