import type { PropertyId, Reservation, RoomId } from "@/domain/reservations/types";

export const ESTI_CSV_HEADERS = [
  "AccomodationPlaceUin",
  "AccomodationRegisterUin",
  "RegistrationDate",
  "IdentityNumber",
  "FirstName",
  "MiddleName",
  "LastName",
  "BirthDate",
  "GenderTypeCode",
  "IdentityDocumentTypeCode",
  "IdentityDocumentNumber",
  "IdentityDocumentCountryCode",
  "Floor",
  "Room",
  "CheckInDate",
  "CheckOutDate",
  "TouristPackage",
  "AvgNightPrice",
  "RegistrationTypeCode"
] as const;

export type EstiCsvHeader = typeof ESTI_CSV_HEADERS[number];
export type EstiGenderTypeCode = "M" | "F" | "";
export type EstiIdentityDocumentTypeCode = "ICA" | "PAS" | "DRL" | "";
export type EstiTouristPackage = "TRUE" | "FALSE";

export type EstiTouristDraft = {
  id: string;
  firstName: string;
  middleName: string;
  lastName: string;
  birthDate: string;
  genderTypeCode: EstiGenderTypeCode;
  identityNumber: string;
  identityDocumentTypeCode: EstiIdentityDocumentTypeCode;
  identityDocumentNumber: string;
  identityDocumentCountryCode: string;
  floor: string;
  room: RoomId | "";
  touristPackage: EstiTouristPackage;
  avgNightPrice: string;
};

export type EstiExportDraft = {
  accomodationPlaceUin: string;
  checkInTime: string;
  checkOutTime: string;
  tourists: EstiTouristDraft[];
};

export type EstiCsvRow = Record<EstiCsvHeader, string>;

export type EstiReservationSnapshot = Pick<Reservation, "id" | "propertyId" | "rooms" | "checkin" | "checkout" | "guestName" | "totalAmount">;

export type EstiRoomOption = {
  propertyId: PropertyId;
  room: RoomId;
};
