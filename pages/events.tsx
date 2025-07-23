import { useState, useEffect } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../config";
import Link from "next/link";
import { useRouter } from "next/router";
import { BsArrowLeft } from "react-icons/bs";
import EventCard from "@/components/card/event";
import GlowingRings from "@/components/animated/glowing";


export default function EventsPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const router = useRouter();

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "nft-images"));
        const eventsData = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setEvents(eventsData);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching events:", err);
        setError("Failed to load events.");
        setLoading(false);
      }
    };
    fetchEvents();
  }, []);

  const handleEventsClick = (id: any) => {
    router.push(`/Join/event/${id}`);
  };

  return (
    <section
      className="relative min-h-screen flex flex-col text-black overflow-hidden bg-white">
      <GlowingRings />
      <div className="flex-grow w-full pt-5 pb-20 px-6 fade-in relative z-10">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="cursor-pointer w-full pb-10 overflow-hidden">
            <Link href="/quests" className="card image-full h-auto rounded-xl">
              <img
                src="./img/bg-hero.svg"
                alt="Quests"
                className="w-full h-48 object-cover bg-opacity-10 rounded-2xl"
              />
              <div className="p-10 w-full text-end z-50 space-y-2 flex items-center justify-end">
                <div className="space-y-2">
                  <span className="font-semibold text-4xl text-white break-words whitespace-nowrap">Coming Up All <span className="bg-gradient-to-r from-sky-400 to-indigo-600 bg-clip-text text-transparent">Events</span></span>
                  <p className="font-normal text-sm flex items-center break-words whitespace-nowrap justify-end gap-2 text-gray-200">
                    <BsArrowLeft />
                    Browse all minted event NFTs.
                  </p>
                </div>
              </div>
            </Link>
          </div>

          {loading && (
            <div className="flex justify-center">
              <svg className="animate-spin h-8 w-8 text-gray-600" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path fill="currentColor" d="M4 12a8 8 0 018-8v8h8a8 8 0 01-16 0z" />
              </svg>
            </div>
          )}

          {error && (
            <div className="alert alert-error mt-2">
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && events.length === 0 && (
            <p className="text-gray-600">No events found.</p>
          )}

          {!loading && !error && events.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {events.map((event) => (
                <EventCard
                  key={event.id}
                  title={event.title}
                  description={event.description}
                  time={event.time}
                  timezone={event.timezone}
                  joiners="0"
                  payment="10 ₳"
                  avatar={event.image}
                  onClick={() => handleEventsClick(event.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}