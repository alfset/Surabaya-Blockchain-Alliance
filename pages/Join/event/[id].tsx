import { useState, useEffect } from "react";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db, auth } from "@/config";
import Link from "next/link";
import { useRouter } from "next/router";
import { FaCalendarCheck, FaCheckCircle, FaChevronLeft, FaCopy, FaGift, FaVideo } from "react-icons/fa";
import ConnectWallet from "@/components/button/ConnectWallet";
import LoadingScreen from "@/components/loading-screen";
import ImageWithFallback from "@/components/image-fallback";
import AlertMessage from "@/components/alert-message";
import EventModal from "@/components/tickets/events";


const isValidCardanoAddress = (address) => {
  return typeof address === "string" && (address.startsWith("addr1") || address.startsWith("addr_test1"));
};

export default function EventDetailsPage() {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [walletAddress, setWalletAddress] = useState(null);
  const [joinStatus, setJoinStatus] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState({ username: "", walletAddress: "" });
  const [hasJoined, setHasJoined] = useState(false);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checkInStatus, setCheckInStatus] = useState("");
  const [hasCheckedIn, setHasCheckedIn] = useState(false);
  const { id } = router.query;

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((firebaseUser) => {
      console.log("Auth state changed:", { uid: firebaseUser?.uid, email: firebaseUser?.email });
      setUser(firebaseUser);
      if (!firebaseUser && id) {
        router.push("/signin");
      }
    });
    return () => unsubscribe();
  }, [id, router]);

  useEffect(() => {
    if (!id) return;

    const fetchEventAndJoinStatus = async () => {
      try {
        const docRef = doc(db, "nft-images", id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setEvent({ id: docSnap.id, ...docSnap.data() });
        } else {
          setError("Event not found.");
        }

        if (user) {
          const joinDocRef = doc(db, `nft-images/${id}/joined`, user.uid);
          const joinDocSnap = await getDoc(joinDocRef);
          setHasJoined(joinDocSnap.exists());
        }

        setLoading(false);
      } catch (err) {
        console.error("Error fetching event:", err);
        setError("Failed to load event.");
        setLoading(false);
      }
    };
    fetchEventAndJoinStatus();
  }, [id, user]);

  // Fetch user profile
  useEffect(() => {
    if (!user) return;

    const fetchUserProfile = async () => {
      try {
        const userDocRef = doc(db, "users", user.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          const userData = userDocSnap.data();
          console.log("User profile fetched:", userData);
          setUserProfile({
            username: userData.username || "",
            walletAddress: userData.walletAddress || "",
          });
        } else {
          console.warn("User profile not found for UID:", user.uid);
          setJoinStatus("❌ User profile not found. Please set up your profile at /profile.");
        }
      } catch (error) {
        console.error("Error fetching user profile:", error);
        setJoinStatus("❌ Failed to fetch user profile. Please try again.");
      }
    };
    fetchUserProfile();
  }, [user]);

  const handleWalletConnect = (address) => {
    if (isValidCardanoAddress(address)) {
      setWalletAddress(address);
      setJoinStatus("✅ Wallet connected.");
      console.log("Wallet connected via ConnectWallet:", address);
    } else {
      console.error("Invalid Cardano address from ConnectWallet:", address);
      setJoinStatus("❌ Invalid wallet address. Please reconnect a valid Cardano wallet.");
    }
  };

  // Handler : Join
  const handleJoinEvent = async () => {
    if (!user || !auth.currentUser || user.uid !== auth.currentUser.uid) {
      console.error("Authentication error: User not authenticated or UID mismatch", {
        user,
        currentUser: auth.currentUser,
      });
      setJoinStatus("❌ User not authenticated. Please sign in again.");
      return;
    }
    if (!walletAddress) {
      console.error("Wallet error: No wallet address", { walletAddress });
      setJoinStatus("❌ Wallet not connected. Please connect a Cardano wallet.");
      return;
    }
    if (!isValidCardanoAddress(walletAddress)) {
      console.error("Wallet error: Invalid Cardano address", { walletAddress });
      setJoinStatus("❌ Invalid wallet address. Please reconnect a valid Cardano wallet.");
      return;
    }
    if (!event) {
      console.error("Event error: Event data not loaded", { event });
      setJoinStatus("❌ Event data not loaded. Please try again.");
      return;
    }
    if (hasJoined) {
      console.log("Join status: Already joined", { userId: user.uid, eventId: id });
      setJoinStatus("✅ You have already joined this event.");
      return;
    }

    try {
      setJoinLoading(true);
      setJoinStatus("⏳ Joining event...");

      const joinData = {
        email: user.email || null,
        username: userProfile.username && userProfile.username !== "" ? userProfile.username : null,
        walletAddress: walletAddress,
        checkedIn: null,
        checkInTimestamp: null,
        nftClaimEligible: null,
        metadata: {
          address: walletAddress,
          username: userProfile.username && userProfile.username !== "" ? userProfile.username : null,
          attestation: "default-attestation",
          eligible: false,
          merkleTreeProof: "default-proof",
        },
        nftClaimed: null,
        nftClaimTxHash: null,
      };

      console.log("Attempting to join event with data:", JSON.stringify(joinData, null, 2));

      const joinDocRef = doc(db, `nft-images/${id}/joined`, user.uid);
      await setDoc(joinDocRef, joinData);
      setHasJoined(true);
      setJoinStatus("✅ Successfully joined event!");
    } catch (error) {
      console.error("Join error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        eventId: id,
        userId: user.uid,
      });
      if (error.code === "permission-denied") {
        setJoinStatus("❌ Permission denied. Please ensure your wallet is connected and your profile is set up correctly.");
      } else {
        setJoinStatus(`❌ Error: ${error.message}`);
      }
    } finally {
      setJoinLoading(false);
    }
  };

  // Handler : Check In
  useEffect(() => {
    if (!id || !user) return;

    const fetchEventAndCheckIn = async () => {
      try {
        const docRef = doc(db, "nft-images", id);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) {
          setError("Event not found.");
          setLoading(false);
          return;
        }

        const eventData = { id: docSnap.id, ...docSnap.data() };
        setEvent(eventData);

        const joinDocRef = doc(db, `nft-images/${id}/joined`, user.uid);
        const joinDocSnap = await getDoc(joinDocRef);

        if (joinDocSnap.exists()) {
          setHasJoined(true);
          const joinData = joinDocSnap.data();
          setHasCheckedIn(!!joinData.checkedIn);
        } else {
          setHasJoined(false);
        }

        setLoading(false);
      } catch (err) {
        console.error("Error fetching event or join data:", err);
        setError("Failed to load event or join data.");
        setLoading(false);
      }
    };

    fetchEventAndCheckIn();
  }, [id, user]);

  const handleCheckIn = async () => {
    if (!user) {
      setCheckInStatus("❌ User not authenticated. Please sign in.");
      return;
    }
    if (!hasJoined) {
      setCheckInStatus("❌ You haven’t joined this event.");
      return;
    }
    if (hasCheckedIn) {
      setCheckInStatus("❌ You have already checked in.");
      return;
    }
    if (!walletAddress) {
      setCheckInStatus("❌ Please connect your wallet.");
      return;
    }

    try {
      const userDocRef = doc(db, "users", user.uid);
      const userDocSnap = await getDoc(userDocRef);
      const username = userDocSnap.exists()
        ? userDocSnap.data().username || "Anonymous"
        : "Anonymous";
      const attestation = `attestation-${user.uid}-${Date.now()}`;
      const eligible = !!(event.policyId && event.assetName);
      const merkleTreeProof = "dummy-proof";

      const metadata = {
        address: walletAddress,
        username: username,
        attestation: attestation,
        eligible: eligible,
        merkleTreeProof: merkleTreeProof,
      };

      const joinDocRef = doc(db, `nft-images/${id}/joined`, user.uid);
      const updateData = {
        checkedIn: true,
        checkInTimestamp: new Date().toISOString(),
        nftClaimEligible: eligible,
        metadata: metadata,
      };

      await updateDoc(joinDocRef, updateData);
      setHasCheckedIn(true);
      setCheckInStatus(
        event.policyId && event.assetName
          ? "✅ Successfully checked in! You are now eligible to claim your NFT."
          : "✅ Successfully checked in!"
      );
    } catch (error) {
      console.error("Check-in error:", error);
      setCheckInStatus(`❌ Error: ${error.message}`);
    }
  };

  const renderImage = (imageUrl) => {
    if (!imageUrl) {
      return (
        <div className="h-full w-full bg-gray-200 flex items-center justify-center text-gray-600 border rounded-lg">
          <span>No Image</span>
        </div>
      );
    }

    let src = imageUrl;
    if (imageUrl.startsWith("ipfs://")) {
      src = `https://sapphire-managing-narwhal-834.mypinata.cloud/ipfs/${imageUrl.replace("ipfs://", "")}`;
    } else if (!imageUrl.startsWith("https://") && !imageUrl.startsWith("data:image/")) {
      src = `https://sapphire-managing-narwhal-834.mypinata.cloud/ipfs/${imageUrl}`;
    }

    return <ImageWithFallback src={src} />;
  };


  if (loading) {
    return <LoadingScreen />;
  }

  if (error || !event) {
    return (
      <section className="relative min-h-screen flex flex-col text-black overflow-hidden bg-gray-100">
        <div className="flex-grow w-full text-center py-20 px-6 fade-in relative z-10">
          <div className="alert alert-error mt-2 max-w-4xl mx-auto bg-red-100 text-red-700 p-4 rounded-lg shadow-md">
            <span>{error || "Event not found."}</span>
          </div>
        </div>
      </section>
    );
  }

  console.log('check in :' + hasCheckedIn)
  console.log('check in status :' + checkInStatus)

  return (
    <section className="relative min-h-screen flex flex-col text-black overflow-hidden bg-white">
      {joinStatus && (
        <div className="px-40">
          <AlertMessage message={joinStatus} />
        </div>
      )}

      {/* New Design */}
      <div className="flex flex-col justify-start items-center gap-6 rounded-none py-3">
        <div className="space-y-4 w-full">
          <div className="card bg-base-100 image-full h-auto w-full px-40 shadow-none">
            <figure>
              {renderImage(event.image)}
            </figure>
            <div className="card-body flex flex-col h-full">
              <div className="flex justify-between items-start">
                <Link href={"/events"}>
                  <h2 className="card-title gap-3">
                    <FaChevronLeft />
                    <span className="pt-2">Back</span>
                  </h2>
                </Link>
                {hasCheckedIn ? <div className="badge badge-soft badge-success pt-1">Joined</div> : ""}
              </div>

              {/* Title & Description */}
              <div className="flex justify-between items-center mt-auto">
                <div className="space-y-1">
                  <h2 className="card-title gap-3 text-4xl">{event.title}</h2>
                  <p>{event.description}</p>
                </div>
                <div className="flex gap-4">
                  <button className="btn btn-outline-primary text-blue-800"><FaCalendarCheck />
                    <span className="pt-1">{new Date(event.time).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: event.timezone || "UTC",
                    })}
                    </span>
                  </button>
                  <Link className="btn btn-primary" target="_blank" href={event.link}>
                    <FaVideo /> <span className="pt-1">Enter Room</span>
                  </Link>
                  <ConnectWallet onConnect={handleWalletConnect} onVerified={undefined} />
                </div>
              </div>
            </div>
          </div>
          <div className="p-4 flex justify-between gap-6 border border-dashed border-gray-400 rounded-lg mx-40">
            <div className="flex flex-col w-full">
              <label htmlFor="">Creator Address</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={event.creator
                    ? `${event.creator}`
                    : "Not Provided"}
                  className="input text-gray-600 placeholder:text-gray-700 w-full"
                  disabled />
                <button className="btn bg-black text-white hover:bg-gray-700 rounded-tr-lg rounded-br-lg"><FaCopy /></button>
              </div>
            </div>
            <div className="flex flex-col w-full justify-start items-start">
              <label htmlFor="">Created At</label>
              <div className="flex gap-2 text-start w-full">
                <button className="btn bg-gray-800 w-full text-gray-100"><FaCalendarCheck />
                  <span className="pt-1">{new Date(event.timestamp).toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: event.timezone || "UTC",
                  })}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* <div className="divider px-40"></div> */}
          <div className="flex flex-col w-full justify-start items-start px-40">
            <div className="flex flex-col space-y-2 gap-2 text-start w-full">

              {walletAddress && (
                <button
                  onClick={handleJoinEvent}
                  className="btn w-full bg-green-600 text-white hover:bg-green-700 shadow-xl rounded-md flex items-center justify-center gap-2 mt-2"
                  disabled={joinLoading || hasJoined}
                >
                  {joinLoading ?
                    <span className="loading loading-dots loading-lg"></span> : hasJoined ? "🙌🏻 Already Joined Event" : "Let's Join Event ✌🏻"}
                </button>
              )}

              {hasJoined && (
                <div className="flex justify-between items-start w-full gap-4">
                  <div className="w-full">
                    <button
                      className="btn w-full transparent border border-blue-700 text-blue-700 hover:bg-blue-700 hover:text-white shadow-xl rounded-md"
                      onClick={() => setOpen(true)} >
                      <FaCheckCircle />
                      <span className="pt-1">Check In</span>
                    </button>
                  </div>
                  <div className="w-full">
                    {event.policyId && event.assetName && (
                      <Link
                        href={`/Join/event/${id}/claim`}
                        className="btn w-full bg-blue-600 text-white hover:bg-transparent hover:text-blue-700 hover:border-blue-700 shadow-xl rounded-md"
                      >
                        <FaGift />
                        <span className="pt-1">Claim Your NFT</span>
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal Check In */}
      <EventModal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={event.title}
        subtitle={event.description}
        date={new Date(event.time).toLocaleDateString("en-US", {
          dateStyle: "medium",
          timeZone: event.timezone || "UTC",
        })}
        day={new Date(event.time).toLocaleDateString("en-US", {
          weekday: "long",
          timeZone: event.timezone || "UTC",
        })}
        time={new Date(event.time).toLocaleTimeString("en-US", {
          timeStyle: "short",
          timeZone: event.timezone || "UTC",
        })}
        location={event.link}
        imageUrl={event.image}
        hasJoined={hasJoined}
        hasCheckedIn={hasCheckedIn}
        checkInStatus={hasCheckedIn ? 'Y' : 'N'}
        walletAddress={walletAddress}
        handleCheckIn={handleCheckIn} />

    </section>
  );
}
