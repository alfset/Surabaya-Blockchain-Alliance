import React, { forwardRef } from 'react';

interface NFTCertificateProps {
  title: string;
  image: string;
  description: string;
  username: string;
  date: string;
  eventId: string;
  organizer: string;
}

const NFTCertificate = forwardRef<HTMLDivElement, NFTCertificateProps>(
  ({ title, image, description, username, date, eventId, organizer }, ref) => {
    return (
      <div
        ref={ref}
        className="bg-white border border-black rounded-xl p-6 sm:p-10 w-full max-w-4xl mx-auto text-black font-serif shadow-md transition-shadow duration-200 hover:shadow-[8px_8px_0px_0px_#487eb0]"
      >
        {/* Top Row: Logo + Metadata */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-2 sm:gap-0">
          <img src={image} alt="Logo" className="h-6 sm:h-8 max-w-xl" />
          <div className="text-xs sm:text-sm text-gray-600 text-right leading-tight max-w-lg">
            <div>
              <strong>Certificate no:</strong> <span className="uppercase">{eventId}</span>
            </div>
          </div>
        </div>

        <div className="uppercase text-xs sm:text-sm font-semibold text-gray-500 mb-2 tracking-wider">
          Certificate of Attendance
        </div>

        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold mb-4 leading-snug">{title}</h1>
        <p className="text-sm sm:text-base mb-6 text-gray-800">{description}</p>
        <div className="text-sm sm:text-base text-gray-800 mb-12">
          Organizer: <span className="font-semibold">{organizer}</span>
        </div>
        <div className="text-lg sm:text-2xl font-bold mb-2">{username}</div>
        <div className="text-sm sm:text-base text-gray-700">
          Date: <span className="font-semibold">{date}</span>
        </div>
      </div>
    );
  }
);

NFTCertificate.displayName = 'NFTCertificate';

export default NFTCertificate;