export type {
  Address,
  BrotherId,
  ConsentSnapshot,
  DeceasedInfo,
  DebrotherInfo,
  EmergencyContact,
  Link,
  PrivacyFlags,
  Profile,
  Role,
  VisibilityClass,
} from "./types.js";
export { DEFAULT_PRIVACY } from "./defaults.js";
export { formatConstitutionId, formatClassYear } from "./format.js";
export { FAKE_ID_FLOOR, TESTER_ID_FLOOR, DEV_PROFILE_IDS } from "./fake-ids.js";
export {
  HEADSHOT_SIZE,
  THUMBNAIL_SIZE,
  thumbnailObjectKey,
  headshotObjectKey,
  imageUrl,
  parseImageObjectKey,
  type ImageKind,
  type ParsedImageKey,
} from "./images.js";
export {
  type UatPhotoManifest,
  uatManifestKey,
  uatPhotoKey,
  uatPhotoName,
} from "./uat-photos.js";
export { normalizeEmail } from "./email.js";
// `formatRecipient` is deliberately NOT re-exported: it splices the address half in
// verbatim and depends on `isEmittableAddress` having been checked first, so
// `buildRecipientList` is the only supported entry point (D167).
export {
  type RecipientCandidate,
  type RecipientList,
  BROTHER_COPY_LIMIT,
  buildRecipientList,
  copyEmailsLimit,
  exceedsCopyEmailsLimit,
  isEmittableAddress,
} from "./email-recipients.js";
export { BANNER_SEVERITIES, type BannerSeverity } from "./banner.js";
export type {
  BounceReport,
  BounceRow,
  Discrepancy,
  DiscrepancyCategory,
  GhostAuditReport,
} from "./ghost-reports.js";
export {
  BUG_REPORT_STATUSES,
  MAX_BUG_REPORT_DESCRIPTION,
  type BugReport,
  type BugReportStatus,
  type BugReportClientContext,
  type AdminBugReport,
} from "./bug-report.js";
export {
  type CanonicalNameInput,
  buildAmbiguityIndex,
  canonicalNameKey,
  formatCanonicalName,
  resolveCanonicalNames,
} from "./canonical-name.js";
export {
  CA_SUBDIVISIONS,
  COUNTRY_CODES,
  US_SUBDIVISIONS,
  countryName,
  hasControlledSubdivisions,
  isCountryCode,
  isSubdivisionCode,
  subdivisionName,
} from "./geo.js";
export {
  MAX_LINKS,
  MAX_EMERGENCY_CONTACTS,
  MAX_EMAIL_LENGTH,
  MAX_SHORT_TEXT_LENGTH,
  normalizePhone,
  firstIssueByField,
  validateProfile,
  type ValidationContext,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";
export {
  type FieldVisibility,
  FIELD_VISIBILITY,
  fieldVisibleToRole,
} from "./visibility.js";
export {
  type WriteRule,
  WRITE_RULE,
  canActOnProfile,
  canExportCsv,
  canImpersonate,
  canWriteField,
  canWriteFieldOnRecord,
  hasUsableEmail,
  impersonatableRoles,
  isRoleDowngrade,
  isRoleEligible,
  isUsableAdmin,
  partitionWritableFields,
  shouldHaveGhostMember,
} from "./capabilities.js";
export { profilesToCsv, neutralizeCsvCell, formatCsvCell } from "./csv.js";
export { isWillingToMentor } from "./mentoring.js";
export {
  type Major,
  type CourseFamily,
  COURSE_FAMILIES,
  MAJORS,
  MAJOR_CODES,
  courseName,
  courseFamily,
  courseLabel,
  compareCourseCodes,
} from "./majors.js";
export {
  type CityOrigin,
  type GeoPoint,
  type RadiusMiles,
  type ZipCentroids,
  DEFAULT_RADIUS_MILES,
  RADIUS_OPTIONS,
  haversineMiles,
  isRadiusMiles,
  isUsAddress,
  isWithinRadius,
  makeProximityPredicate,
  memberPoint,
  normalizeZip,
  parseCityTable,
  parseZipTable,
} from "./proximity.js";
