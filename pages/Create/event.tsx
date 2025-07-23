import { useState, useEffect } from "react";
import { getAssetInfoFromTx, getAssetOwner } from "@/utils/indexing";
import { BrowserWallet, Transaction, ForgeScript } from "@meshsdk/core";
import { uploadFile } from "../../utils/upload";
import { FaCalendarCheck, FaGoogle, FaVideo, FaWallet } from "react-icons/fa";
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
      value: "zoom",
      label: "Zoom",
      icon: (
        <svg height="20" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="zoom-gradient" x1="0.952" x2="497.137" y1="511.048" y2="14.862" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#0079ff" />
              <stop offset="1" stopColor="#00c2ff" />
            </linearGradient>
          </defs>
          <path fill="url(#zoom-gradient)" d="M256,0C114.615,0,0,114.615,0,256S114.615,512,256,512,512,397.385,512,256,397.385,0,256,0Zm65.382,328.892a9.268,9.268,0,0,1-9.267,9.268H155.145a45.812,45.812,0,0,1-45.812-45.812V183.108a9.268,9.268,0,0,1,9.268-9.268h156.97a45.811,45.811,0,0,1,45.811,45.811Zm81.285,3.235a4.219,4.219,0,0,1-6.659,3.442l-66.656-47.233V223.663l66.656-47.233a4.22,4.22,0,0,1,6.659,3.443Z" />
        </svg>
      ),
    },
  ];


  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
      } else {
        router.push("/signin");
      }
      setCheckingAuth(false);
    });

    return () => unsubscribe();
  }, [router]);

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
      tagsArray = tags.split(",").map(t => t.trim()).filter(t => t.length > 0);
    }
    setForm((prev) => ({ ...prev, tags: tagsArray.join(",") }));
    console.log("tags : " + form.tags)
  };


  useEffect(() => {
    if (form.date && form.time && form.platform) {
      const meetLink = generateMeetLink(form.platform, form.date, form.time);
      setForm((prev) => ({ ...prev, meetLink }));
    }
  }, [form.date, form.time, form.platform]);

  const generateMeetLink = (platform, date, time) => {
    if (!date || !time) return "";
    const randomKey =
      platform === "zoom"
        ? Math.floor(1000000000 + Math.random() * 9000000000).toString()
        : `${Math.random().toString(36).substring(2, 5)}-${Math.random()
          .toString(36)
          .substring(2, 6)}-${Math.random().toString(36).substring(2, 5)}`;
    return platform === "zoom"
      ? `https://zoom.us/j/${randomKey}`
      : `https://meet.google.com/${randomKey}`;
  };

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
        throw new Error("Insufficient balance. You need at least 1 ADA to handle tx fee.");
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
      src = `https://sapphire-managing-narwhal-834.mypinata.cloud/ipfs/${imageUrl.replace("ipfs://", "")}`;
    } else if (!imageUrl.startsWith("https://") && !imageUrl.startsWith("data:image/")) {
      src = `https://sapphire-managing-narwhal-834.mypinata.cloud/ipfs/${imageUrl}`;
    }

    return <ImageWithFallback src={src} />
  };

  if (checkingAuth) {
    return <LoadingScreen />;
  }
  if (!user) {
    return null;
  }

  return (
    <section className="relative min-h-screen flex flex-col text-black overflow-hidden bg-white">
      <div className="flex justify-between gap-10 px-40">
        <div className="space-y-3 w-full">
          <div className="card bg-base-100 image-full h-96 w-full shadow-none">
            <figure>
              {form.image && <div className="h-full">{renderImage(form.image)}</div>}
            </figure>
            <div className="card-body flex flex-col h-full">

              {/* Title & Description */}
              <div className="flex flex-col justify-start items-start space-y-2 mt-auto">
                <div className="space-y-1">
                  <h2 className="card-title gap-3 text-4xl">
                    {form.name || "Event Name Preview"}
                  </h2>
                  <p>{form.description || "Event Description Preview"}</p>
                </div>

                <div className="flex gap-4">
                  {/* Date & Time */}
                  {(form.date && form.time) && (
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

                  {/* Enter Room */}
                  {form.meetLink && (() => {
                    const platform = platformOptions.find((opt) => opt.value === form.platform);
                    return platform ? (
                      <Link className={`btn btn-sm ${platform.value == 'zoom' ? 'btn-white': 'btn-primary'}`} target="_blank" href={form.meetLink}>
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
            {/* Wallet Button */}
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

            {/* Mint Button */}
            {walletAddress && (
              <button
                onClick={handleSignMinter}
                className="btn bg-blue-600 cursor-pointer text-white border-none hover:bg-blue-800 w-full mt-2"
                disabled={loading}
              >
                {loading ? "Minting..." : "Mint NFT [0 ₳]"}
              </button>
            )}
          </div>
        </div>

        {/* Form Event Created */}
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
            {/* Name */}
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

            {/* Image */}
            <div className="form-control">
              <label className="label text-black capitalize">
                Event Banner  {loading && (
                  <span className="loading loading-dots loading-lg"></span>
                )}
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
              {/* Date */}
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

              {/* Time */}
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

              {/* Timezone */}
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

            {/* Platform */}
            <div className="grid grid-cols-3 gap-3">
              <div className="form-control">
                <label className="label text-black capitalize">
                  Conference Call
                </label>
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


              {/* Meet Link */}
              <div className="form-control col-span-2">
                <label className="label text-black capitalize">
                  {form.platform === "zoom" ? "Zoom" : "Google Meet"} Link
                </label>
                <input
                  type="url"
                  name="meetLink"
                  placeholder={
                    form.platform === "zoom"
                      ? "https://zoom.us/j/..."
                      : "https://meet.google.com/..."
                  }
                  value={form.meetLink}
                  onChange={(e) => setForm({ ...form, meetLink: e.target.value })}
                  className="input input-bordered w-full bg-transparent"
                  disabled={loading}
                />
              </div>
            </div>


            {/* Description */}
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

            {/* Fee */}
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


      {/* Modal Connect Wallet */}
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
      )
      }
    </section >
  );
}
