import { DEFAULT_PRIVACY } from "@pbe/shared";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_COLUMNS,
  capShortText,
  convertGenesisCsv,
  parseCsv,
  parseLooseDate,
} from "./genesis-convert.js";

const NOW = "2026-09-16T12:00:00.000Z";

/** Build a CSV from partial rows keyed by column name (the fake exemplar space only). */
function csv(rows: Partial<Record<(typeof REQUIRED_COLUMNS)[number], string>>[]): string {
  const header = REQUIRED_COLUMNS.join(",");
  const lines = rows.map((row) =>
    REQUIRED_COLUMNS.map((c) => {
      const v = row[c] ?? "";
      return /[",\n]/u.test(v) ? `"${v.replace(/"/gu, '""')}"` : v;
    }).join(","),
  );
  return `${header}\n${lines.join("\n")}\n`;
}

const smyth = {
  "Const ID": "5247",
  "Full Name": "James Alan Smyth",
  "First Name": "James",
  "Middle Name": "Alan",
  "Last Name": "Smyth",
  Class: "1984",
  Email: "James.Smyth@example.com",
  "Alternate Email": "jsmyth@example.org",
  Mugname: "Jim",
  Nickname: "Jimmy",
  Course: "6-3, 15",
  Sports: "Crew",
  Interests: "Sailing",
  "Addr Line 1": "1 Main St",
  "Addr Line 2": "Apt 2",
  "Addr City": "Boston",
  "Addr State": "MA",
  "Addr Zip": "02116-1234",
  Phone: "6175551212",
  Company: "Example Corp",
  "Job Title": "Engineer",
};

function data(result: ReturnType<typeof convertGenesisCsv>, id: number) {
  const doc = result.collections.profiles.find((p) => p.id === String(id));
  if (!doc) {
    throw new Error(`no profile ${id}`);
  }
  return doc.data;
}

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded newlines, CRLF and a BOM", () => {
    const text = '﻿a,b\r\n1,"x, ""y""\nz"\r\n2,\r\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["1", 'x, "y"\nz'],
      ["2", ""],
    ]);
  });
});

describe("parseLooseDate", () => {
  it("accepts a bare year and a loosely-padded full date", () => {
    expect(parseLooseDate("1919")).toEqual({ year: 1919 });
    expect(parseLooseDate("1928-1-7")).toEqual({ year: 1928, date: "1928-01-07" });
    expect(parseLooseDate("Jan 1928")).toBeNull();
  });
});

describe("capShortText", () => {
  it("truncates at a word boundary only past the cap", () => {
    const long = `${"word ".repeat(30)}tail`;
    const [text, truncated] = capShortText(long);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(120);
    expect(text.endsWith("word")).toBe(true);
    expect(capShortText("short")).toEqual(["short", false]);
  });
});

describe("convertGenesisCsv", () => {
  it("maps a living brother's row field by field with the shared privacy default", () => {
    const result = convertGenesisCsv(csv([smyth]), { now: NOW, adminIds: [5247] });
    expect(result.issues).toEqual([]);
    const p = data(result, 5247);
    expect(p).toMatchObject({
      id: 5247,
      firstName: "James",
      middleName: "Alan",
      lastName: "Smyth",
      classYear: 1984,
      email: "james.smyth@example.com",
      alternateEmail: "jsmyth@example.org",
      mugName: "Jim",
      nickname: "Jimmy",
      majors: ["6-3", "15"],
      sports: "Crew",
      activities: "Sailing",
      phone: "+1 (617) 555-1212",
      employerName: "Example Corp",
      jobTitle: "Engineer",
      address: {
        street1: "1 Main St",
        street2: "Apt 2",
        city: "Boston",
        stateProvince: "MA",
        postalCode: "02116-1234",
        country: "US",
      },
      deceased: { isDeceased: false },
      debrothered: { isDebrothered: false },
      hasHeadshot: false,
      unlisted: false,
      allowNewsletterEmail: true,
      allowShareWithMITAA: false,
      willingToMentor: false,
      role: "admin",
      lastModified: NOW,
      newsletterConsentChangedAt: NOW,
    });
    // The D163 obligation: the shared default, all five true — never a copy.
    expect(p.privacy).toEqual(DEFAULT_PRIVACY);
    expect(DEFAULT_PRIVACY.shareEmergency).toBe(true);
    // Full Name equals the join, so no fullLegalName.
    expect(p).not.toHaveProperty("fullLegalName");
    expect(result.stats).toMatchObject({ rows: 1, admins: 1, withEmail: 1, withAddress: 1 });
  });

  it("leaves role off everyone who is not an admin (brother by omission)", () => {
    const result = convertGenesisCsv(csv([smyth]), { now: NOW });
    expect(data(result, 5247)).not.toHaveProperty("role");
    expect(result.stats.admins).toBe(0);
  });

  it("keeps a differing Full Name as fullLegalName (suffixes, go-by names)", () => {
    const result = convertGenesisCsv(csv([{ ...smyth, "Full Name": "James Alan Smyth Jr." }]), {
      now: NOW,
    });
    expect(data(result, 5247).fullLegalName).toBe("James Alan Smyth Jr.");
  });

  it("maps a deceased brother: dates, obituary, newsletter off, birth year", () => {
    const result = convertGenesisCsv(
      csv([
        {
          ...smyth,
          Deceased: "Deceased",
          "Date of Birth": "1919",
          "Date of Death": "2001-3-9",
          Obituary: "https://example.com/obit",
        },
        {
          ...smyth,
          "Const ID": "5248",
          Email: "other@example.com",
          "Alternate Email": "",
          Deceased: "Deceased",
          "Date of Death": "1966",
        },
      ]),
      { now: NOW },
    );
    expect(result.issues).toEqual([]);
    expect(data(result, 5247).deceased).toEqual({
      isDeceased: true,
      birthYear: 1919,
      dateOfDeath: "2001-03-09",
      obituaryUrl: "https://example.com/obit",
    });
    expect(data(result, 5247).allowNewsletterEmail).toBe(false);
    expect(data(result, 5248).deceased).toEqual({ isDeceased: true, deathYear: 1966 });
    expect(result.stats.deceased).toBe(2);
  });

  it("drops an alternate email that merely repeats the primary", () => {
    const result = convertGenesisCsv(
      csv([{ ...smyth, "Alternate Email": "JAMES.SMYTH@example.com" }]),
      { now: NOW },
    );
    expect(data(result, 5247)).not.toHaveProperty("alternateEmail");
    expect(result.issues).toEqual([
      expect.objectContaining({ severity: "warning", id: 5247, field: "alternateEmail" }),
    ]);
  });

  it("skips a nameless row and drops an unrecognisable phone, both with warnings", () => {
    const result = convertGenesisCsv(
      csv([
        { ...smyth, "First Name": "", "Last Name": "", "Full Name": "{NAME SCRATCHED OUT}" },
        {
          ...smyth,
          "Const ID": "5248",
          Email: "b@example.com",
          "Alternate Email": "",
          Phone: " 85221319985",
        },
      ]),
      { now: NOW },
    );
    expect(result.collections.profiles.map((p) => p.id)).toEqual(["5248"]);
    expect(data(result, 5248)).not.toHaveProperty("phone");
    expect(result.issues.map((i) => `${i.severity}:${i.id}:${i.field}`)).toEqual([
      "warning:5247:firstName",
      "warning:5248:phone",
    ]);
  });

  it("marks a debrothered brother with the run timestamp", () => {
    const result = convertGenesisCsv(csv([{ ...smyth, Debrothered: "Debrothered" }]), {
      now: NOW,
    });
    expect(data(result, 5247).debrothered).toEqual({ isDebrothered: true, debrotheredAt: NOW });
  });

  it("maps a foreign address by country name and keeps the foreign city verbatim", () => {
    const result = convertGenesisCsv(
      csv([
        {
          ...smyth,
          "Addr City": "",
          "Addr State": "",
          "Addr Zip": "",
          "Addr Foreign City": "London N2 9NT",
          "Addr Foreign Country": "United Kingdom",
        },
      ]),
      { now: NOW },
    );
    expect(result.issues).toEqual([]);
    expect(data(result, 5247).address).toEqual({
      street1: "1 Main St",
      street2: "Apt 2",
      city: "London N2 9NT",
      country: "GB",
    });
  });

  it("carries a Canadian province and postcode, and free-text state elsewhere", () => {
    const result = convertGenesisCsv(
      csv([
        {
          ...smyth,
          "Addr City": "Toronto",
          "Addr State": "on",
          "Addr Zip": "M5V 3L9",
          "Addr Foreign Country": "Canada",
        },
        {
          ...smyth,
          "Const ID": "5248",
          Email: "b@example.com",
          "Alternate Email": "",
          "Addr City": "",
          "Addr State": "Bavaria",
          "Addr Zip": "80331",
          "Addr Foreign City": "München",
          "Addr Foreign Country": "Germany",
        },
      ]),
      { now: NOW },
    );
    expect(result.issues).toEqual([]);
    expect(data(result, 5247).address).toMatchObject({
      city: "Toronto",
      stateProvince: "ON",
      postalCode: "M5V 3L9",
      country: "CA",
    });
    expect(data(result, 5248).address).toMatchObject({
      city: "München",
      stateProvince: "Bavaria",
      postalCode: "80331",
      country: "DE",
    });
  });

  it("treats USA / Puerto Rico in the foreign column as domestic, and errors on an unknown country", () => {
    const result = convertGenesisCsv(
      csv([
        { ...smyth, "Addr Foreign Country": "USA" },
        {
          ...smyth,
          "Const ID": "5248",
          Email: "b@example.com",
          "Alternate Email": "",
          "Addr City": "San Juan",
          "Addr State": "",
          "Addr Zip": "00901",
          "Addr Foreign Country": "Puerto Rico",
        },
        {
          ...smyth,
          "Const ID": "5249",
          Email: "c@example.com",
          "Alternate Email": "",
          "Addr Foreign Country": "Atlantis",
        },
      ]),
      { now: NOW },
    );
    expect(data(result, 5247).address).toMatchObject({
      stateProvince: "MA",
      postalCode: "02116-1234",
      country: "US",
    });
    expect(data(result, 5248).address).toMatchObject({
      stateProvince: "PR",
      postalCode: "00901",
      country: "US",
    });
    expect(data(result, 5249)).not.toHaveProperty("address");
    expect(result.issues).toEqual([
      expect.objectContaining({ severity: "error", id: 5249, field: "address.country" }),
    ]);
  });

  it("refuses a snapshot the restore would refuse: one email claimed by two profiles", () => {
    const result = convertGenesisCsv(
      csv([
        smyth,
        {
          ...smyth,
          "Const ID": "5248",
          Email: "other@example.com",
          "Alternate Email": "james.smyth@example.com",
        },
      ]),
      { now: NOW },
    );
    expect(result.issues.map((i) => `${i.severity}:${i.field}`)).toEqual(["error:emailUniqueness"]);
  });

  it("ignores fully-empty rows a spreadsheet export leaves behind", () => {
    const text = `${csv([smyth])},,,,,,,,,,,,,,,,,,,,,,,,,,,,\n`;
    const result = convertGenesisCsv(text, { now: NOW });
    expect(result.issues).toEqual([]);
    expect(result.stats.rows).toBe(1);
  });

  it("drops what the schema cannot hold, with a warning naming the row", () => {
    const result = convertGenesisCsv(
      csv([
        {
          ...smyth,
          Course: "6-3, 99, 6-3",
          "Addr Zip": "NOZAA",
          "Addr State": "ZZ",
          Sports: `${"long ".repeat(30)}end`,
          "Date of Birth": "1960",
          "Addr Foreign Country": "",
        },
      ]),
      { now: NOW },
    );
    const p = data(result, 5247);
    expect(p.majors).toEqual(["6-3"]);
    expect(p.address).not.toHaveProperty("postalCode");
    expect(p.address).not.toHaveProperty("stateProvince");
    expect((p.sports as string).length).toBeLessThanOrEqual(120);
    const fields = result.issues.map((i) => `${i.severity}:${i.field}`).sort();
    expect(fields).toEqual([
      "warning:address.postalCode",
      "warning:address.stateProvince",
      "warning:deceased",
      "warning:majors",
      "warning:sports",
    ]);
    expect(result.issues.every((i) => i.id === 5247)).toBe(true);
  });

  it("stamps headshots for the ids that have one and warns about strays", () => {
    const result = convertGenesisCsv(csv([smyth]), {
      now: NOW,
      headshotVersions: new Map([
        [5247, "abc123"],
        [9999, "zzz"],
      ]),
    });
    expect(data(result, 5247)).toMatchObject({ hasHeadshot: true, headshotVersion: "abc123" });
    expect(result.issues).toEqual([
      expect.objectContaining({ severity: "warning", id: 9999, field: "hasHeadshot" }),
    ]);
    expect(result.stats.withHeadshot).toBe(1);
  });

  it("errors on a duplicate id, a dangling Big Brother, a missing admin and a bad row", () => {
    const result = convertGenesisCsv(
      csv([
        smyth,
        { ...smyth, Email: "", "Alternate Email": "" },
        {
          ...smyth,
          "Const ID": "5300",
          "Big Brother ID": "9999",
          "Last Name": "",
          Email: "x@example.com",
          "Alternate Email": "",
        },
      ]),
      { now: NOW, adminIds: [5247, 6000] },
    );
    const errors = result.issues
      .filter((i) => i.severity === "error")
      .map((i) => `${i.id}:${i.field}`);
    expect(errors).toEqual(
      expect.arrayContaining(["5247:id", "0:referenceIntegrity", "5300:lastName", "6000:role"]),
    );
    expect(result.collections.profiles.map((p) => p.id)).toEqual(["5247", "5300"]);
  });

  it("refuses a file missing a column", () => {
    const result = convertGenesisCsv("Const ID,First Name\n1,x\n", { now: NOW });
    expect(result.collections.profiles).toEqual([]);
    expect(result.issues[0]).toMatchObject({ severity: "error", field: "file" });
  });
});
