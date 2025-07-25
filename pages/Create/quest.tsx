import { useState, useEffect } from "react";
import { BsCheck2Circle } from "react-icons/bs";
import ConnectWallet from "@/components/button/ConnectWallet";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import Footer from "@/components/footer";
import { doc, setDoc, collection as collectionRef, getDocs, runTransaction } from "firebase/firestore";
import { db, auth } from "@/config";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { BsArrowLeft } from "react-icons/bs"; 
import { Teko } from "next/font/google";

const geistTeko = Teko({
  variable: "--font-geist-teko",
  subsets: ["latin"],
});

interface Task {
  taskType: string;
  link: string;
  points: number;
}

interface FormState {
  name: string;
  description: string;
  reward: string;
  deadline: string;
  tasks: Task[];
  tokenPolicyId: string;
  tokenName: string;
  scriptAddress: string;
}

interface Quest {
  id: string;
  name: string;
  description: string;
  reward: string;
  deadline: string;
  status: string;
  creator: string;
  avatars?: string;
  media?: string[];
}

export default function CreateQuestPage() {
  const [form, setForm] = useState<FormState>({
    name: "",
    description: "",
    reward: "",
    deadline: "",
    tasks: [],
    tokenPolicyId: "",
    tokenName: "",
    scriptAddress: "",
  });

  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [twitterTaskModal, setTwitterTaskModal] = useState<{
    open: boolean;
    taskType: string;
    usernames: string;
    tweetUrl?: string;
  }>({ open: false, taskType: "", usernames: "", tweetUrl: "" });
  const [quests, setQuests] = useState<Quest[]>([]); // New state for quests
  const [hasActiveQuests, setHasActiveQuests] = useState<boolean>(false); // New state for active quests

  const router = useRouter();
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    const fetchQuests = async () => {
      try {
        const questsSnapshot = await getDocs(collectionRef(db, "quests"));
        const questsData = questsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Quest[];
        setQuests(questsData);

        // Check if any quest is active
        const active = questsData.some((quest) => {
          const deadlineDate = new Date(quest.deadline);
          const currentDate = new Date();
          const isNotPastDeadline = deadlineDate >= currentDate;
          const isNotEnded = quest.status.toLowerCase() !== "end";
          return isNotPastDeadline && isNotEnded;
        });
        setHasActiveQuests(active);
      } catch (err) {
        console.error("Error fetching quests:", err);
      }
    };
    fetchQuests();
  }, []);

  useEffect(() => {
    const styleSheet = document.createElement("style");
    styleSheet.type = "text/css";
    styleSheet.innerText = `
      @keyframes bg-scrolling-reverse {
        100% { background-position: -50px -50px; }
      }
    `;
    document.head.appendChild(styleSheet);
    return () => {
      document.head.removeChild(styleSheet);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      console.log("Auth state changed:", !!currentUser);
      setUser(currentUser);
      setAuthReady(true);
      if (!currentUser && authReady) {
        console.log("Redirecting to /signin");
        router.push({
          pathname: "/signin",
          query: { redirect: router.asPath },
        });
      }
    });
    return () => unsubscribe();
  }, [authReady, router]);

  useEffect(() => {
    if (walletAddress) {
      setForm((prev) => ({ ...prev, scriptAddress: walletAddress }));
    }
  }, [walletAddress]);

  const handleTaskChange = (
    index: number,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const updatedTasks = [...form.tasks];
    const { name, value } = e.target;
    updatedTasks[index][name] =
      name === "points" ? Math.max(1, parseInt(value) || 1) : value;
    setForm({ ...form, tasks: updatedTasks });
  };

  const addTask = (taskType: string) => {
    if (["Follow Twitter", "Retweet Tweet", "Like Tweet"].includes(taskType)) {
      setTwitterTaskModal({ open: true, taskType, usernames: "", tweetUrl: "" });
    } else {
      setForm({
        ...form,
        tasks: [...form.tasks, { taskType, link: "", points: 1 }],
      });
    }
  };

  const handleTwitterUsernameChange = (usernames: string) => {
    setTwitterTaskModal({ ...twitterTaskModal, usernames });
  };

  const handleAddTwitterTask = async () => {
    const { taskType, usernames, tweetUrl } = twitterTaskModal;

    if (taskType === "Follow Twitter") {
      if (!usernames.trim()) {
        toast.error("Please enter a Twitter username.");
        return;
      }

      const username = usernames.trim().replace(/^@/, "");
      if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) {
        toast.error("Please enter a valid Twitter username.");
        return;
      }

      setForm({
        ...form,
        tasks: [...form.tasks, { taskType, link: username, points: 1 }],
      });
      setTwitterTaskModal({
        open: false,
        taskType: "",
        usernames: "",
        tweetUrl: "",
      });
    } else {
      if (!tweetUrl?.trim()) {
        toast.error("Please enter a tweet URL.");
        return;
      }
      const tweetId = tweetUrl.match(/status\/(\d+)/)?.[1];
      if (!tweetId) {
        toast.error("Invalid tweet URL.");
        return;
      }

      setForm({
        ...form,
        tasks: [...form.tasks, { taskType, link: tweetUrl, points: 1 }],
      });
      setTwitterTaskModal({
        open: false,
        taskType: "",
        usernames: "",
        tweetUrl: "",
      });
    }
  };

  const removeTask = (index: number) => {
    const updatedTasks = form.tasks.filter((_, i) => i !== index);
    setForm({ ...form, tasks: updatedTasks });
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleCreateQuest = async () => {
    if (!auth.currentUser) {
      toast.error("User not authenticated. Please sign in.");
      return;
    }

    try {
      console.log("Starting quest creation for user:", auth.currentUser.uid);
      setLoading(true);
      setStatus("Creating quest...");

      if (
        !form.name ||
        !form.description ||
        !form.tokenPolicyId ||
        !form.tokenName ||
        !form.reward ||
        !form.deadline ||
        !form.scriptAddress ||
        form.tasks.length === 0 ||
        form.tasks.some((task) => !task.link)
      ) {
        toast.error("Please fill all fields, including task links and script address.");
        return;
      }

      const rewardNum = parseInt(form.reward);
      if (isNaN(rewardNum) || rewardNum < 0) {
        toast.error("Reward must be a valid positive number.");
        return;
      }

      const deadlineDate = new Date(form.deadline);
      if (isNaN(deadlineDate.getTime()) || deadlineDate < new Date()) {
        toast.error("Deadline must be a valid future date.");
        return;
      }

      const counterRef = doc(db, "metadata", "questCounter");
      let newQuestId: number;

      await runTransaction(db, async (transaction) => {
        console.log("Transaction started for counterRef:", counterRef.path);
        const counterDoc = await transaction.get(counterRef);
        console.log("Counter Doc Exists:", counterDoc.exists(), "Data:", counterDoc.data());
        if (!counterDoc.exists()) {
          console.log("Setting initial counter");
          transaction.set(counterRef, { lastQuestId: 0 });
          newQuestId = 1;
        } else {
          const lastQuestId = counterDoc.data()?.lastQuestId || 0;
          newQuestId = lastQuestId + 1;
          console.log("New Quest ID:", newQuestId);
        }
        transaction.update(counterRef, { lastQuestId: newQuestId });
      });

      const questRef = doc(db, "quests", newQuestId.toString());
      const questData = {
        name: form.name,
        description: form.description,
        reward: rewardNum,
        deadline: form.deadline,
        tasks: form.tasks,
        tokenPolicyId: form.tokenPolicyId,
        tokenName: form.tokenName,
        scriptAddress: walletAddress || form.scriptAddress,
        status: "active",
        createdAt: new Date().toISOString(),
        startDate: new Date().toISOString(),
        endDate: form.deadline,
        id: newQuestId.toString(),
        creatorUid: auth.currentUser.uid,
      };

      console.log("Writing to questRef:", questRef.path, "Data:", questData);
      await setDoc(questRef, questData);

      toast.success(`Quest Created! ID: ${newQuestId}`);
      setStatus(`✅ Quest Created! ID: ${newQuestId}`);
      router.push(`/quest/${newQuestId}/do`);
    } catch (err: any) {
      console.error("Quest creation error:", err);
      setStatus(`❌ Error: ${err.message}`);
      if (err.code === "permission-denied") {
        toast.error("You lack permission to create quests. Ensure you are signed in and authorized.");
      } else {
        toast.error(`Failed to create quest: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const bgImage =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAIAAACRXR/mAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAIGNIUk0AAHolAACAgwAA+f8AAIDpAAB1MAAA6mAAADqYAAAXb5JfxUYAAABnSURBVHja7M5RDYAwDEXRDgmvEocnlrQS2SwUFST9uEfBGWs9c97nbGtDcquqiKhOImLs/UpuzVzWEi1atGjRokWLFi1atGjRokWLFi1atGjRokWLFi1af7Ukz8xWp8z8AAAA//8DAJ4LoEAAlL1nAAAAAElFTkSuQmCC";

  if (!authReady) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{
          fontFamily: 'Exo, Ubuntu, "Segoe UI", Helvetica, Arial, sans-serif',
          background: `url(${bgImage}) repeat 0 0`,
          animation: "bg-scrolling-reverse 0.92s linear infinite",
        }}
      >
        <div className="text-black font-semibold bg-white p-4 rounded-lg shadow-md">
          Loading authentication...
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
      style={{
        fontFamily: 'Exo, Ubuntu, "Segoe UI", Helvetica, Arial, sans-serif',
        background: `url(${bgImage}) repeat 0 0`,
        animation: "bg-scrolling-reverse 0.92s linear infinite",
      }}
    >
      <div
        className="w-full text-gray-800 flex flex-col md:flex-row justify-between items-start gap-5 p-4"
      >
        <div className="bg-white w-full max-w-xl shrink-0 shadow-2xl py-5 px-10 max-h-[100vh] overflow-y-auto">
          {hasActiveQuests && (
            <button
              onClick={() => router.push("/")}
              className="bg-transparent animate-pulse rounded-full inline-flex items-center gap-2 text-gray-600 justify-center mb-4"
            >
              <BsArrowLeft className="text-xs" />
              <span className={`font-semibold ${geistTeko.variable}`}>Back to Home</span>
            </button>
          )}

          <div className="flex justify-between items-center">
            <img src="/img/logo.png" alt="Cardano Hub Indonesia" width={200} />
          </div>

          <div className="pt-16 pb-5">
            <h1 className="text-3xl font-extrabold text-black">Create Quest</h1>
            <p className="text-sm font-medium text-black">Enter your quest and reward pool details</p>
          </div>

          <div className="space-y-4">
            <div className="form-control">
              <label className="label text-black">Quest Name</label>
              <input
                type="text"
                name="name"
                placeholder="Enter quest name"
                value={form.name}
                onChange={handleChange}
                className="input input-bordered w-full bg-transparent text-black"
              />
            </div>

            <div className="form-control">
              <label className="label text-black">Quest Description</label>
              <textarea
                name="description"
                placeholder="Enter quest description"
                value={form.description}
                onChange={handleChange}
                className="textarea textarea-bordered w-full bg-transparent text-black"
                rows={4}
              />
            </div>

            <div className="form-control">
              <label className="label text-black">Total Reward (Tokens)</label>
              <input
                type="number"
                name="reward"
                placeholder="Enter total token reward"
                value={form.reward}
                onChange={handleChange}
                className="input input-bordered w-full bg-transparent text-black"
                min="0"
              />
            </div>

            <div className="form-control">
              <label className="label text-black">Token Policy ID</label>
              <input
                type="text"
                name="tokenPolicyId"
                placeholder="Enter token policy ID"
                value={form.tokenPolicyId}
                onChange={handleChange}
                className="input input-bordered w-full bg-transparent text-black"
              />
            </div>

            <div className="form-control">
              <label className="label text-black">Token Name</label>
              <input
                type="text"
                name="tokenName"
                placeholder="Enter token name"
                value={form.tokenName}
                onChange={handleChange}
                className="input input-bordered w-full bg-transparent text-black"
              />
            </div>

            <div className="form-control">
              <label className="label text-black">Script Address</label>
              <input
                type="text"
                name="scriptAddress"
                placeholder="Connect wallet to set address"
                value={form.scriptAddress}
                className="input input-bordered w-full bg-transparent text-black"
                disabled
              />
            </div>

            <div className="form-control">
              <label className="label text-black">Claim Deadline</label>
              <input
                type="date"
                name="deadline"
                value={form.deadline}
                onChange={handleChange}
                className="input input-bordered w-full bg-transparent text-black"
                min={new Date().toISOString().split("T")[0]}
              />
            </div>

            <div className="space-y-4">
              <h3 className="text-xl font-semibold text-black">Tasks</h3>
              {form.tasks.map((task, index) => (
                <div key={index} className="form-control flex items-center gap-4">
                  <input
                    type="text"
                    name="link"
                    value={task.link}
                    onChange={(e) => handleTaskChange(index, e)}
                    placeholder={`Link for ${task.taskType}`}
                    className="input input-bordered w-1/2 text-black"
                    disabled={task.taskType === "Follow Twitter"}
                  />
                  <input
                    type="number"
                    name="points"
                    value={task.points}
                    onChange={(e) => handleTaskChange(index, e)}
                    placeholder="Points"
                    className="input input-bordered w-1/4 text-black"
                    min="1"
                  />
                  <button
                    className="btn btn-danger w-1/6 bg-red-500 text-white hover:bg-red-600"
                    onClick={() => removeTask(index)}
                  >
                    Remove
                  </button>
                </div>
              ))}

              <div className="flex gap-4 flex-wrap">
                <button className="btn btn-primary bg-blue-500 text-white hover:bg-blue-600" onClick={() => addTask("Follow Twitter")}>
                  Add Follow Twitter Task
                </button>
                <button className="btn btn-primary bg-blue-500 text-white hover:bg-blue-600" onClick={() => addTask("Retweet Tweet")}>
                  Add Retweet Tweet Task
                </button>
                <button className="btn btn-primary bg-blue-500 text-white hover:bg-blue-600" onClick={() => addTask("Visit Website")}>
                  Add Visit Website Task
                </button>
              </div>
            </div>

            <ConnectWallet
              onConnect={(address: string) => setWalletAddress(address)}
              onVerified={(address: string) => setWalletAddress(address)}
            />

            <button
              className="btn w-full bg-black text-white hover:bg-gray-800 flex items-center justify-center disabled:opacity-50"
              onClick={handleCreateQuest}
              disabled={loading || !auth.currentUser}
            >
              {loading ? "Creating..." : "Create Quest"}
              <BsCheck2Circle className="text-lg ml-2" />
            </button>

            {status && (
              <div className="alert alert-info mt-2 text-black">
                <span>{status}</span>
              </div>
            )}
          </div>
        </div>

        <div className="bg-transparent text-center p-10 md:p-48 flex-1">
          <h1 className="text-4xl font-semibold text-black">
            <span className="text-blue-800">Cardano Hub</span>{" "}
            <span className="text-red-600">Indonesia</span>
          </h1>
          <DotLottieReact
            src="https://lottie.host/7b819196-d55f-494b-b0b1-c78b39656bfe/RD0XuFNO9P.lottie"
            loop
            autoplay
            style={{ width: "100%", maxWidth: "700px", margin: "0 auto" }}
          />
          <p className="text-lg font-medium text-black">Create quests and engage communities!</p>
        </div>
      </div>

      {twitterTaskModal.open && (
        <div className="fixed inset-0 bg-gray-800 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-md w-full">
            <h3 className="text-xl font-semibold text-black mb-4">Add {twitterTaskModal.taskType} Task</h3>
            <div className="form-control">
              {twitterTaskModal.taskType === "Follow Twitter" ? (
                <>
                  <label className="label text-black">Twitter Username</label>
                  <input
                    type="text"
                    placeholder="e.g., cardanohubindonesia"
                    value={twitterTaskModal.usernames}
                    onChange={(e) => handleTwitterUsernameChange(e.target.value)}
                    className="input input-bordered w-full bg-transparent text-black"
                  />
                </>
              ) : (
                <>
                  <label className="label text-black">Tweet URL</label>
                  <input
                    type="text"
                    placeholder="e.g., https://twitter.com/user/status/123456789"
                    value={twitterTaskModal.tweetUrl || ""}
                    onChange={(e) =>
                      setTwitterTaskModal({ ...twitterTaskModal, tweetUrl: e.target.value })
                    }
                    className="input input-bordered w-full bg-transparent text-black"
                  />
                </>
              )}
            </div>
            <div className="flex gap-4 mt-4">
              <button className="btn btn-primary w-1/2 bg-blue-500 text-white hover:bg-blue-600" onClick={handleAddTwitterTask}>
                Add Task
              </button>
              <button
                className="btn btn-secondary w-1/2 bg-gray-500 text-white hover:bg-gray-600"
                onClick={() =>
                  setTwitterTaskModal({ open: false, taskType: "", usernames: "", tweetUrl: "" })
                }
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <ToastContainer position="bottom-right" autoClose={3000} />
    </div>
  );
}