"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookingResolvers = exports.resolveBookingsIndex = void 0;
const utils_1 = require("../../../lib/utils");
const mongodb_1 = require("mongodb");
const api_1 = require("../../../lib/api");
exports.resolveBookingsIndex = (bookingsIndex, checkInDate, checkOutDate) => {
    let dataCursor = new Date(checkInDate);
    let checkOut = new Date(checkOutDate);
    const newBookingsIndex = bookingsIndex;
    while (dataCursor <= checkOut) {
        const y = dataCursor.getUTCFullYear();
        const m = dataCursor.getUTCMonth();
        const d = dataCursor.getUTCDate();
        if (!newBookingsIndex[y]) {
            newBookingsIndex[y] = {};
        }
        if (!newBookingsIndex[y][m]) {
            newBookingsIndex[y][m] = {};
        }
        if (!newBookingsIndex[y][m][d]) {
            newBookingsIndex[y][m][d] = true;
        }
        else {
            throw new Error(' selected dates cannot overlap dates that have already been booked');
        }
        dataCursor = new Date(dataCursor.getTime() + 86400000);
    }
    return newBookingsIndex;
};
exports.bookingResolvers = {
    Mutation: {
        createBooking: (_root, { input }, { db, req }) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const { id, source, checkIn, checkOut } = input;
                // check if viewer exists
                let viewer = yield utils_1.authorize(db, req);
                if (!viewer) {
                    throw new Error('viewer cannot be found');
                }
                // check if listing exists
                const listing = yield db.listings.findOne({
                    _id: new mongodb_1.ObjectId(id)
                });
                if (!listing) {
                    throw new Error('listing cannot be found');
                }
                // check if listing host is the viewer
                if (listing.host === viewer._id) {
                    throw new Error('viewer cannot book own listing');
                }
                // check to see if checkIn is AFTER checkOut
                const checkInDate = new Date(checkIn);
                const checkOutDate = new Date(checkOut);
                if (checkOutDate < checkInDate) {
                    throw new Error('check out date cannot be before check in date');
                }
                // update bookingsIndex object
                const bookingsIndex = exports.resolveBookingsIndex(listing.bookingsIndex, checkIn, checkOut);
                // update total price
                const totalPrice = listing.price * ((checkOutDate.getTime() - checkInDate.getTime()) / 86400000 + 1);
                // check if Host is connected to Stripe
                const host = yield db.users.findOne({
                    _id: listing.host
                });
                if (!host || !host.walletId) {
                    throw new Error('Host cannot be found or is not connected with Stripe');
                }
                // Run charge() function from Stripe instance
                yield api_1.Stripe.charge(totalPrice, source, host.walletId);
                // Update documents in different collections in DB
                // update Bookings DB
                const insertRes = yield db.bookings.insertOne({
                    _id: new mongodb_1.ObjectId(),
                    listing: listing._id,
                    tenant: viewer._id,
                    checkIn,
                    checkOut
                });
                const insertedBooking = insertRes.ops[0];
                // update Users DB
                // update host income
                yield db.users.updateOne({ _id: host._id }, { $inc: { income: totalPrice } });
                // update bookings of user
                yield db.users.updateOne({ _id: viewer._id }, { $push: { bookings: insertedBooking._id } });
                // update Listings DB
                // update bookingsIndex and bookings array 
                yield db.listings.updateOne({ _id: listing._id }, {
                    $set: { bookingsIndex },
                    $push: { bookings: insertedBooking._id }
                });
                return insertedBooking;
            }
            catch (error) {
                throw new Error(`Failed to create booking: ${error}`);
            }
        })
    },
    Booking: {
        id: (booking) => {
            return booking._id.toString();
        },
        listing: (booking, _args, { db }) => {
            return db.listings.findOne({ _id: booking.listing });
        },
        tenant: (booking, _args, { db }) => {
            return db.users.findOne({ _id: booking.tenant });
        }
    }
};
