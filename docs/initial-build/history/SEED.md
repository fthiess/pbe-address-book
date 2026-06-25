> **Preserved historical artifact** — moved into the repo from the planning vault at the Session-6c close-out (2026-06-07) for historical value. These are the *original* implementation seed notes the project started from; they are **not** maintained and are **not** referenced by the engineering docs. Where the delivered documents (`../PRD.md`, `../DATABASE-SCHEMA.md`, `../ENGINEERING-DESIGN.md`, `../API-SPEC.md`, `../CODING-PROJECT-PLAN.md`, `../USER-MANUAL.md`) or `../DECISIONS.md` differ from anything here, those govern. Real personal information in the original examples has been replaced with the fake exemplar "James Smyth '84"; one first-person class-year anecdote is retained as originally authored.

# What This Document Is
This document contains initial notes on how the address book project could be implemented—it’s a combination of casual early thoughts on requirements, design, and implementation—those will be created by fleshing out details around the ideas discussed here. AIs using this document should use it as a seed or starting point, but not be constrained by it; they should feel free to suggest alternatives and better ideas. The intent is to work through a dialog that begins with this document and ends with formalized requirements and design, and formal implementation plan.

The formal documents created from this document *may* include:
* Product Requirements Document
* Database Schema
* Engineering Design Document
* Coding Project Plan
* User Manual

Where newer documentation exists (such as the formal documents listed above) it should be assumed to take precedence over this document.

# Background
* PBE (Phi Beta Epsilon) is an undergraduate fraternal living group (a “fraternity”) at MIT. It was founded in 1890 and today has ~40 active (undergraduate) members, and ~800 alumni members.
* Until 1990 PBE had a paper address book of members’ contact information that was occasionally updated. The last two books were published in 1984 and 1990. Since that time PBE has relied upon the MIT Alumni Association (MITAA) for member address information.
* With the creation of the online PBE News (bi-annual alumni newsletter) in 2025, MITAA’s data was found to be woefully inadequate, with many errors and omissions. We therefore began a project to create our own, modern, accurate, online address book for the PBE brotherhood (the PBE Address Book project).
* For the most part, this address book application is a basic CRUD database and UI.

# Terminology
- **PBE** or **Phi Beta Epsilon**: the fraternity this address book will serve.
- Brothers: members of PBE.
- **PBE News**: a bi-annual online publication of the PBE alumni. It’s members-only website resides at pbe400.org. PBE News is published using the [Ghost](https://ghost.org/) publishing platform, hosted using the Ghost Pro service.
- **Book**: the working name of the PBE online address book web application. It’s is tentatively planned to reside at book.pbe400.org. We may give it a different name and/or different domain name later, but for initial discussions we’ll use Book and book.pbe400.org.
- **Profile**: data record stored in Book containing all the information about one specific brother.

# Brother Profile Schema
The primary dataset managed by Book is the collection of brother profiles. Each profile is the complete set of data about one brother.

The front end of Book, an SPA running in the browser, will download the entire profile database—including thumbnails but excluding the headshots, due to their size—when the browser first opens the page.

## Fields
- **ID** (required)
	- *This is the primary key for the brother table, providing a unique identifier for each brother*. Happily, there is a natural, human-meaningful choice for this ID: the sequence number of their signature on the PBE Constitution, with values incrementing from 1 in 1890 to ~1300 today, with no duplicates.
	- Rationale: brothers’ names sometimes have multiple forms, their graduation years can have nuances, etc. Constitution signing order number is unique, permanent, and invariant, while also being meaningful to humans.
- *Name Fields*
	- **First Name** (REQUIRED)
	- **Middle Name**
	- **Last Name** (REQUIRED)
	- **Full Legal Name**
		- This is different from just a combination of First+Middle+Last: some people have multiple middle names, or multiple last names, but for everyday purposes use simpler First+Middle+Last. This field is where the full (but usually seldom-used) name can be recorded.
		- This is also where suffixes like “Jr.”, “III”, etc. would be recorded.
	- **Canonical Name** 
		- *This is a constructed field, not a stored one*. It is built by concatenating First Name, Last Name, and Class Year (e.g. “James Smyth ‘84”). This is the standard form used in PBE News. (If there is no class year, only First Name and Last Name are used).
	- **Mug Name**
		- This is a nickname printed on an official PBE mug awarded to new brothers.
	- Example:
		- First: James
		- Middle: Louis
		- Last: Smyth
		- Class Year: 1984
		- Full Legal Name: James Louis Angelo St. John-Smythe III
		- Mugname: Lissajous Figure
		- Canonical Name: James Smyth ‘84
- **Class Year** (required, but see notes below)
	- This is the normal graduation year of the class the brother pledged with—which is not necessarily the same as the year this brother graduated in.
		- Example: I pledged to PBE in 1980; 1984 is my class year, the year I normally would have graduated in, but I was in a BS/MS program and actually received my first degree in 1986.
	- Might be phrased as “the class year you identify with”.
	- This will always be displayed as an apostrophe followed by a two digit number (e.g. ‘84), but internally will be a 4-digit year (the actual data type could be anything that can represent a 4-digit year).
	- I’d like this to be required, but in our initial dataset we have many brothers—especially from early in PBE’s history—for whom we don’t yet know their class year. Maybe we make this a required field, but use a special value to indicate “unknown” (e.g. 0 if internally stored numerically, or maybe “UNKN” if stored as a string)?
		- Unknown years should be displayed as an apostrophe followed by two question marks, “‘??”, or they might not be displayed at all.
- *Contact Info Fields*
	- **Email Address**
	- **Alternate Email Address** (only enabled for entry if there is already an Email Address)
	- **Telephone Number** (should be possible to enter international numbers, too)
	- **Home Physical Address**
		- Need to deal with US format vs. many different formats in other countries
		- Here’s what MITAA’s database uses:
			- **Street 1**
			- **Street 2**
			- **Street 3**
			- **City**
			- **State/Province**
			- **Zip**
			- **Country**
		- Consider whether we should do any validation/auto-complete on physical addresses: lots of websites do this, but I have no idea how reliable this is, and we wouldn’t want to do it if it wasn’t a free service.
	- *Emergency Contact Fields* (We’d mostly use these if we can’t get in contact with a brother via other means)
		- **Emergency Contact Name**
		- **Emergency Contract Telephone**
		- **Emergency Contact Email**
	- We should probably have 2 emergency contacts, so two of each of the fields listed above
- *Professional Info Fields*
	- **Job Business Name**
	- **Job Title**
- *Photographs*
	- **Headshot**
		- Photograph to that will be displayed on their profile, and used as by-line photo if they write an article in PBE News
		- TBD: Need to determine aspect ratio, dimensions, and acceptable file formats (probably JPG and PNG)
		- After a headshot is uploaded, before storing it the app should display a simple cropping UI; the user sets the crop, pushes “save”, and the cropped photo is uploaded. This would both allow the app to have a standard aspect ratio for headshots, and it would allow users to upload any photo they wanted, perhaps with multiple people and background, and then crop down to just themselves, saving them time by not having to do this in a separate image editing tool.
	- **Thumbnail**
		- This is a small thumbnail image generated from the profile’s headshot. It could be generated when needed, but that would be quite slow, so we’re essentially going to precompute and cache the thumbnails so they can be quickly and efficiently used when needed.
		- TBD: need to determine aspect ratio (probably the same as headshot), dimensions, and file format (JPG? PNG? WEBP?)
- **Big Brother**
	- This is an ID for another brother that the record’s brother has a big-brother/little-brother mentoring relationship with. Taken together the linked set of Big Brother IDs form an acyclic directed graph, specifically a directed tree.
- *Links to other sites*: LinkedIn, Bluesky, personal websites, work websites, etc. We don’t want to pre-judge what sites someone might want to provide, so we’ll offer 5 (subject to revision) sets of links, each of which will have two fields:
	- **Site Name**
	- **Site Link**
- **Spouse/Partner Name**
- **Undergraduate Major** (gets complicated if we go into graduate stuff, and no need: people only lived at PBE as undergrads... but even undergrad majors can be complicated)
	- We may want to control how these are entered so, for example, we don’t get “EE”, “Electrical Engineering”, and “6-1” (which are all the same thing) being entered by different people.
	- The list of available majors changes over time; valid majors 50 years ago may be different than valid majors today.
	- Undergraduate majors at MIT are numeric;, sometimes with alpha subdivisions e.g. 6-1, 6-3, 4-B. They also change over time, e.g. 6-1 is being replaced by 6-5.
	- Some people double-major, e.g. 6-3 (Computer Science) and 15 (Management).
- **Deceased Status**
	- If deceased or not (can only be set by a manager or administrator)
		- If brother is deceased, display the words “In Memoriam” in large, respectful, type across the top of the page.
	- If deceased, display additional optional fields
		- **Date of Death**
		- **Link to Public Obituary**
		- **Link to PBE News “In Memoriam” Article**
- *Permission to Use Info* (several binary yes/no fields)
	- **Allow PBE News Email** (if yes, we’ll email PBE News to them; defaults to TRUE)
	- **Share Email, Telephone, Address with Brothers** (three different fields)
		- These will default to being TRUE
		- These control whether other non-manager/admin brothers will see this brother’s email, telephone, or address on the search/filter/sort and profile pages.
	- **Allow Sharing with MITAA** (if TRUE, we’ll occasionally share with MIT; defaults to TRUE)
	- *Maybe: Subscription Status with Mailman Mailing Lists* (itemize, permissions on each one). An open design issue is how Book could/should integrate with these mailing lists. See Interaction with Other Systems, below.
		- **Member of pbe-official** (mailing list for official PBE announcements)
		- **Member of pbe-connect** (mailing list for informal messages)
- **Date Information Last Verified**
	- This is different than date last updated; we want people to periodically look at their info and, if everything is still accurate, to click a button, just to let us know they’ve verified it. This doesn’t update the data, but it’s useful to know that the information was still good as of a certain date.
		- Actually, this could be considered as an update, because they’re updating the last verified date field.
	- This is different than a change of information by a manager or administrator. A manager or administrator might change an email address because someone gave them a new address for the brother... but that’s different than the brother themselves verifying all the info is good.
- **Stars**
	- This is a list of brother IDs that the brother referred to by this record has “starred” in the user interface.

# Database Sizing
- PBE was founded in 1890 and has only exists at MIT, so the number of brothers is limited: just ~1200 brothers since founding, and in recent years, adding about 30–50 each year. Of that number only about ~800 are living. It will have records for all brothers, living and dead. This means that:
	* The app’s database will only have  less than 2000 records for the foreseeable future
	* The number of actual users is likely to be 500–600
	* Those users will generally only update their profiles once every 5–10 years, and will likely only do 4–5 searches of the database per year
	* Newsletters, consisting of 20–30 articles each, will be published twice per year
* The database will be more heavily used by a linter that will be run on draft newsletter articles to look up names article authors have used in their articles (e.g. “Jim Smyth”) and canonicalize them (e.g. convert to “James Smyth ‘84”). Each article will mention 1–20 names that need to be canonicalized.
* All of this implies that the database will be quite small (leaving aside photos of brothers, which can be handled separately) and can probably just be loaded entirely into memory in both the web app and the linter, with all searching/sorting/filtering being done by the app itself without relying on the database. I think this makes NoSQL a good choice for the database.

# User Interface
- Specifics
	- Pages in the Book app
		- **Search/filter/sort page**
			- This page is available to all users
			- Has UI fields at the top of the page for entering search and filter parameters, and for choosing which columns/fields should be displayed (and perhaps what order those columns are displayed in, though I’d prefer that ordering be done by drag-and-drop of the actual columns in the UI)
				- The search box should have fuzzy matching so it will match misspelled and similar-sounding (soundex?) names. I’m open to suggestions, but one possibility would be to use the [Fuse.js](https://www.fusejs.io/) library.
			- Displays rows for all profiles matching the search and filter parameters
				- The rows include thumbnail images from each profile
				- Not sure if this should be paginated or infinite scroll
				- It should be possible to filter on any field that it makes sense to filter on.
					- Where it makes sense, it should be possible to filter on a comma-separated list of values.
					- Where it makes sense, it should be possible to filter on a dash-separated range of values (e.g. “1990-1995”).
					- Where it makes sense, it should be possible to filter on a comma-separated combination of individual values and ranges.
					- When filtering on years, always use 4-digit years to avoid ambiguity (is “21” 1921 or 2021?)
				- The filter should default to Deceased = False (so it should, by default, only display living brothers)
				- There should be a UI affordance that, when clicked, sets a filter that requires displayed rows to be on the user’s personal star list. Clicking the affordance again, removes that filter.
				- Clicking the star field in any row will add that profile ID to the user’s star list; if it’s already starred, clicking it will remove that profile ID from the user’s star list.
			- Clicking anywhere on a row will cause Book to move to displaying the profile page for the brother whose record was clicked on
				- Idea: while we want a full-page profile view, maybe we should also provide a modal profile view that pops up on top of the search/filter/sort view when a row is clicked?
				- We might want to have a link/button at the end of each row that says “Search News”, or maybe just a magnifying glass icon, that, if clicked, goes to a Ghost search page. The effect would be if you click on the search function on a brother in Book you’d be taken to a Ghost search results page that would show you every mention of the brother in PBE News
					- Problem: Ghost’s search function doesn’t search any content, only article author names and article titles. We’d have to expand the capabilities of Ghost search, first.
			- Every other row should have a subtle background color, to make it easy to follow rows across the page.
			- When the user’s mouse is over a row, that row should dynamically highlight.
			- The left-most four columns will *always* be Select, Star, Thumbnail, and Canonical Name. The other columns displayed will be selectable within the UI, but will default to:
				- Select (an empty or checked box; this is not a database field—it’s a UI element that allows the user to select rows for further action). Note: the select check box will only be visible to managers and administrators, because it would have no function for brothers.
				- Star (showing either an outline of a star if the record is not on the user’s star list, or a gold filled-in star if the record is on their star list)
				- Thumbnail
				- Canonical Name
				- Class Year
				- Major
				- Email Address
				- Telephone Number
				- City
				- State/Province
				- Country
			- Column headings can be clicked on to set sorting by that column; repeatedly clicking a column heading toggles between sorting ascending and descending.
			- The user should be able to re-order columns, possibly excluding the first few (Star, Thumbnail, Canonical Name). Ideally, the user can just drag-and-drop columns by clicking and holding on column headers, to put them in the order they want.
			- If the user is displaying more columns of information than can be displayed on their device, a horizontal scroll bar should appear so they can still view the entire set of columns.
			- Near the search and filter options on the top of the page should be a reset button that clears the current search/filter/sort settings. It should not clear the user’s choice of which columns to display or their order.
			- [This article](https://uxplanet.org/tables-that-arent-boring-a-guide-to-creating-visually-appealing-and-informative-data-tables-e20e885dd3cf) has good suggestions for making a page like this with great UX
			- Managers and administrators (only) will see an “Export” button on the page that, when clicked, will download a CSV containing either the selected records, or, if none are selected, all the records from the current search/filter/sort parameters.
				- The CSV file will have a header row containing unique names for all columns, and the first column will be the IDs of each record in the database.
				- Headshots and thumbnails will never be downloaded by the export function. The only way to bulk download these will be through the backup function.
			- Administrators (only) will see the following buttons:
				- “Add Brother” button that will take the administrator to a blank profile page that, if saved, will create a new brother profile record in the database.
				- “Delete Brothers” button that will delete the selected rows (if any) from the database.
				- A “Regenerate Thumbnails” button that will cause Book to regenerate thumbnails from headshots for all selected rows.
		- **Profile page**
			- This page is available to all users
			- Displays all the information in the brother’s profile, including their headshot. The only information not displayed is their thumbnail.
			- If a new headshot is uploaded by the user, Book should automatically scale it down and save it as a thumbnail, too, when the user pushes “Save”.
			- Maybe include a “Search PBE News” button that would take you to a search results page in Ghost that shows all mentions of that brother in PBE News? (This same function is mentioned as a possibility for the search/filter/sort page, too). Problem: the Ghost search function doesn’t search content, only article names and authors.
			- The owner of the profile, managers, and administrators, will see an “Edit” button that makes the fields on the page editable. When the page shifts to edit mode, “Save” and “Cancel” buttons will appear that will cause any changes to be written to the database, or removed, respectively. Pressing Save or Cancel will move the page back to view mode.
			- Administrators (only) will see the following buttons
				- A “Delete Brother” button that will cause the current profile record to be deleted. When pressed a scary-looking warning modal dialog should pop up asking if the user is sure, with “Cancel” and “Proceed to Delete” buttons.
				- A “Toggle Privileges” button that will cycle privileges for the viewed brother between Brother, Manager, and Administrator.
		- **Report page**
			- This page is available to all users
			- This page is a “nice-to-have”
			- Displays a nice graphical report about the contents of the Book database, including (at the moment these are just early ideas):
				- Total number of brothers
				- A pie chart showing living and deceased brothers
				- A bar chart showing number of living brothers by decade of Class Year (e.g. 1950s, 1960s, 1970s, etc.)
					- Perhaps make this a stacked bar chart, with the lower portion of each bar corresponding to the number of brothers in that decade *with* an email address in Book, and the upper part being brothers in that decade *without* an email address in Book.
		- **Administrator page**
			- This page will only be accessible by administrators
			- It will offer buttons for the following functions:
				- Download database backup
				- Upload and restore database backup
				- Upload a bulk update CSV
					- The format of the CSV is the same format as the export CSV.
					- The header row is required, but only the ID column is required.
					- Any rows present will modify the profiles for the brothers with the IDs matching the value in the ID column. Columns with headings present will override the existing database contents for those fields in the record; columns whose headings are absent will leave the fields unmodified. A blank field in a named column means to erase the current value of that field.
					- If the ID does not match any profile in the database, a new record will be created with the fields filled in from the remaining columns in the row.
					- After the upload and update is complete a modal dialog box will appear giving the number of records updated and added.
				- Sync with Ghost
					- Accesses the Ghost member database via API and compares it to the Book database. TBD: what to do with discrepancies? If someone changes something in Ghost, should it overwrite what’s in Book? Or should Book be considered to be the primary source, and overwrite Ghost? Or just flag it for the admin?
	- Affordances in the UI to set dark mode and make fonts larger/smaller (easier on older alums’ eyes)
	- Ability to “star” people a user searches for frequently so they’re easier to find (we could go all-in and allow tagging people, but it’s probably better to keep the UI simple).
	- Whenever possible, data entered by the user will be validated before being accepted. For example, email fields will be checked to see if their format appears to be an email address (e.g. name@domain.tld), dates will be checked for correct format.
	- The upper left or right corner of the page will be a small “person” icon (perhaps a small icon made by downscaling their headshot?).
		- Clicking the icon will take the user to their own profile page.
		- Next to the icon will be a visible indication if the user is logged in with manager or administrator privileges (perhaps a small colored bar with the word “MANAGER” or “ADMINISTRATOR”?)
	- I’m open to other possibilities, but I’d prefer to implement the UI using a library like [MUI](https://mui.com/) or [shadcn/ui](https://ui.shadcn.com/?ref=shadcn.com) so it has a slick, professional, consistent appearance.
	- This document referenced a separate note of CRUD UIs the editor found visually attractive (kept in the planning vault, not carried into the repo).
- Generalities
	- App needs to work as well on a cellphone as on a desktop
		- This means it needs to use responsive design: the layout automatically adjusts as the window size changes
		- It also means the click targets can’t be too small, or too close together
	- Use semantic HTML: makes it easier to understand for everyone (humans, screen readers, AIs, Javascript/CSS)
	- Visually attractive user interface
		- I would like to identify some websites I find attractive, then use Claude Design to create a pleasing design based on those inspirations
	- Easily “theme-able” CSS styles: CSS related to UI styling should all be in the same place and designed to be easy to change the appearance of the UI without having to hunt down obscurely-named CSS rules with complicated behavior across many source files to find what you need to modify.
	- Dates will always be displayed, and only accepted as input, in modified ISO 8601 format: YYYY-MM-DD.
	- Good browser behavior:
		- Shift-clicking links (“open in a new tab/window”) should work (example: a list of items is displayed in response to a query; you should be able to either click an item to see it in detail, or shift-click to have the detail page open in a new window.)
			- I *think* this means a single user on a single computer could actually be running multiple instances of the SPA frontend, all with their own state.
		- Pressing the back button in a browser should take you to the previous screen (example: a list of items is displayed in response to a query; you click on and the browser goes to a new page that displays details for that item. If you press back, you should go back to the same query response list view, scrolled to the same position you were at before clicking through to the item view).
		- If the page being viewed is an SPA, the SPA should use the HTML5 History API (e.g. window.history.pushState()) and other appropriate mechanisms to silently update the URL in the browser bar to reflect changes in the state and appearance of the page, so the user can easily save or share the URL to quickly access the page with the same sort/filter and other settings.

# Authentication
- I want to use my Ghost site, pbe400.org, to authenticate users for book.pbe400.org, via an authentication bridge:
	- How this can be done: Users will access the web app by going to a special Ghost page, perhaps pbe400.org/book, and Ghost will use Handlebars template at that page to craft a cryptographically secure authentication token that it passes when it redirects to a callback URL for my webapp. If the user wasn’t logged into Ghost, Ghost will require them to login before continuing; if they are logged in, book.pbe400.org gets an auth token from Ghost, and now sets it’s own auth cookie on the browser under it’s own domain name.
	- If an unauthenticated user goes to book.pbe400.org, they will be redirected to pbe400.org/book, which will authenticate them with Ghost, then send them back to book.pbe400.org.
	- Most users will get to book.pbe400.org by going to pbe400.org first and clicking a link/button. However, if they’ve already authenticated with Book, they can use it directly without going through pbe400.org first.
	- Book will maintain its own table of user permission levels, independent of Ghost.
- While we will be using Ghost to do our authentication, I foresee possible scenarios where that might not always be the case. Ideally, the design of Book should make it straightforward to change out its authentication system to something else in the future, though this is not a strict requirement.

# Application Architecture
## Single Page Application (SPA)
Book should probably be implemented as an SPA (Single Page Application). Other than the headshots, the database is quite small and can downloaded completely into the browser, with all search/filter/sort, display, and edit operations being performed locally by the frontend running in the browser, with updates being sent back to the backend on a remote server. This will yield much faster responses for the user, much less compute and network load on the server, and enable the use of a NoSQL database.

The frontend will communicate with the backend via an API described in the API section of this document.

## Frontend
- The frontend for the app will run entirely in the user’s browser.
- It will probably be based on React, but I’m open to alternatives.
- The frontend should be written in Typescript (preferred) or Javascript.
- When the frontend starts it downloads the entire profile database, except headshots, into the browser. All filter/search/sort and display operations are done locally with no further API calls to the backend, except to retrieve headshots as needed.

## Backend
- The backend for Book should run on a serverless platform, probably Google Cloud Run with Firebase NoSQL (I’m most familiar with the Google ecosystem, though I’m open to alternatives: Vercel? Netlify?)
	- The number of users, the number of records in the database, and the number of transactions are all quite small; by using a serverless platform we can take advantage of very low pricing—quite possibly within the free tier.
	- The consequences of serverless are (a) a few seconds of app start-up time sometimes, and (b) more database processing work has to be handled by the app, rather than the database. These seem reasonable tradeoffs for the scaling and cost benefits of serverless and NoSQL.
- The backend has more options on implementation language than the frontend, but for consistency and simplicity across the the full codebase, it should probably be in the same Typescript or Javascript used for the frontend, and run in Node.js. 

## API
The frontend communicates with the backend via an API. This API could potentially be used by other applications to access Book’s data, but there’s currently no known use case for such a situation, so the initial deployment of Book does not need to include an authentication system to allow API use by other apps.
- Book has an HTTPS/REST API that can be used to programmatically retrieve brother information.
- Payload data sent in either direction using the API are encoded in JSON.
- Authentication
	- We want to rely on Ghost’s authentication for user interactions, so is there a way the API could rely on Ghost for authentication, too?
		- Maybe some kind of feature on our Ghost site that gives the user an API key?
	- Only managers and admins should be able to use the API.
- API calls
	- /profile
		- GET is an incoming API request with one optional parameter, a list of brother IDs. If a list of IDs is specified, Book returns the set of the brother profile records for those IDs. If no list of IDs is specified, the backend returns the complete set of all profile records. This API call returns all fields *except* headshots, which must be requested separately, for performance reasons.
		- PUT/PATCH sends a set of brother profile records to the backend, and the backend will update the corresponding records in its database. Note: should this always be PATCH? It seems like updates will usually be partial, and it may require more code to add PUT as a separate feature?
			- Unlike GET, which does *not* include headshots, PATCH *may* include them, though they can also be updated by PUT/PATCHing to /headshot.
		- POST sends one or more profile record to the backend to create new profile records. It does not need to include all possible fields, just the mandatory ones. The backend responds with the IDs of the newly created records. It’s allowed to include headshots in POSTs, though they can also be sent by POSTing to /headshot.
		- DELETE has one parameter, a brother ID. It instructs the backend to delete that specific profile from its database.
		- Something to consider: since all search/filter/sort operations are done on the frontend, /profile only returns all fields for the IDs requested. Would there be any value in allowing search, filter, and sort parameters are part of the /profile API call? Maybe this is something to consider for later, if/when we allow the API to be used by other applications?
	- /headshot
		- GET is an API request supplies a brother ID and Book returns just the headshot from the specified brother’s profile. This is used when displaying a single brother’s profile: the frontend already has all the other fields to display; this API call gives it the one thing it’s missing, the headshot photograph.
		- PATCH is used to update a headshot (the record already exists, so not POST, and we’re only updating one field, so not PUT)
		- TBD: Should we allow a list of brother IDs in GET and PATCH, so multiple headshots can be requested or updated at the same time?

## Cookies
Besides Mixpanel analytics cookies, Book needs to store user preferences in the browser. Book should maintain state across sessions for the following items using cookies:
* Preferred font size
* Preferred dark mode (dark, light, or system)
* Preferred display columns on the search/filter/sort page and their order

## Distributed System Considerations
- While the entire text database can be downloaded at once, headshot photos are only needed when displaying individual profile pages, so they can be downloaded as they are needed.
	- This implies: the backend will have an API call to return all profiles
* An important architectural question is how to design the system so that it supports multiple users making updates to the database at the same time. Here’s one possibility—basically Optimistic Concurrency Control, I think—but I’d like advise on what current distributed systems best practices are in this area:
	* Every record already has a Last Modified field.
	* When a client (user’s browser) sends an update, it sends the modified record with the Last Modified value it received from the server. When the server stores the updated information, it updates Last Modified to the current date/time.
	* If the server sees in the incoming record is *older* than Last Modified, it fails the transaction, and the client pops up a message for the user that the record changed before it could be saved. What happens next:
		* Option 1: The client repulls the new record, throwing away whatever changes the user made. If the user wishes, they can re-enter their changes and try again.
		* Option 2: The client repulls the new record, tries its best to merge it with the changes the client made, highlighting fields where it couldn’t due to a conflict, and invites the user to try again.
	* A related question is what to do in general when there are multiple clients, each with their own local copy of the database, when a change is made to the central database? Does the central app notify the clients? Do we hope for the best and fail any client that tries to change a modified record?
	* Note that our numbers are small, so it should be rare for any of these conflicts to actually happen... but we need to plan for how to handle a conflict because sooner or later, they will.

# Database Synchronization with Ghost
- The Ghost membership database contains a subset of the Book brother database. Because Ghost is a separate application whose code is currently outside our control, we end up with two copies of the same data, managed by different applications. Further, both Ghost and Book allows users to edit their personal information. How to keep the two in sync?
- Book should automatically push changes in its database to Ghost using the Ghost API.
- The administrator will periodically run a “Sync with Ghost” function in the Book admin UI that will cause Book to read the entire Ghost membership database and flag discrepancies for the administrator.
- TBD: what to do about  discrepancies in the sync.
	- Option 1: Administrator resolves them manually.
	- Option 2: Book makes changes to its database so it matches the Ghost database, on the theory that if a user made a change, they want it made everywhere.
		- One danger here: if the user made a change in Book and the API update to Ghost fails, Ghost’s record will be different than Book’s, and we don’t want Book to then apply the perceived “change” back to itself, effectively undoing the user’s change.
	- Option 3: Use Ghost’s routing function to redirect /account to the corresponding page in Book, effectively bypassing Ghost’s profile editing and turning it all over to Book.
	- Maybe we should disable profile editing in Ghost; replace the Ghost profile edit page with a message and link to change information in Book

# Testing
- Book needs a suite of unit tests that test all it’s basic functions. As major parts of Book are implemented those tests should be passed before moving on to implement the next part of the application, and previously completed parts should be re-tested to ensure no regressions have been inadvertently created.
	- Most functions will need to be tested in a browser; we need to use a browser testing tool that can be controlled by our AI coding agent to accomplish this.
	- We’ll need a test database with many fake brother profiles that exercise various features in the app.
		- It should look realistic, but not have any information about real people, or that could be confused by humans as being real (so use silly names, obviously fake domain names, etc.)

# Deployment
- Book code will be archived in GitHub.
- The Ghost and Book databases need to be synced before Book goes live
	- Alternately, perhaps the initial sync could be performed by the regular “Sync with Ghost” admin function?

# Permission Levels
- General pubic
	- Any user who access book.pbe400.org that is not authenticated will be redirected to pbe400.org/book, which will tell them they need login.
- Brothers
	- There will be about 600 brothers using the app. They will rarely be using it at the same time, *except* for the 3 days after publication of a new issue of PBE News, when traffic on pbe400.org will be heaviest. It stands to reason that traffic on Book will be heaviest then, too, but it will be much lighter. The heaviest load on Book will be right after Book is launched when Brothers are trying it out and updating their information within a few days of each other.
	- Once authenticated, brothers will be able to
		- View and edit their own profile
			- This includes controlling which items in their profile will be visible to other Brothers and Managers
		- View others’ profiles
		- Search, filter, and sort the database
- Managers
	- We expect there to be 3–5 managers.
	- Once authenticated, Managers can carry out all functions Brothers can, plus
		- Edit any open profile information for any brother
		- Add Brothers
		- From a search/filter/sort view, export all open profile information for every Brother in the view to a CSV file
- Administrators
	- We expect there to be 1–2 administrators.
	- Once authenticated, administrators can carry out all functions Managers can, plus
		- Edit any field, whether open or not, or any profile
		- From a search/filter/sort view, export all profile information, open or not, for every Brother in the view to a CSV file
		- Delete Brothers
		- Make bulk edits of the database by uploading CSV files
		- Can run a Ghost/Book synchronization check

# Logging and Analytics
- A log should be maintained of everything the app is doing
- The app should be instrumented to work with our web analytics system, Mixpanel.
	- It should not only track page views, but also things like button clicks etc. so we can easily tell how users and using the website, what features they’re using, etc., to drive future development.

# Backups
- There needs to be a way to do both manual and automated backup of the entire web app database, and then to reload the app from one of those backups, when necessary.
- Backing up the text fields to a file is probably easy. The headshots need to be backed up as well, but they probably shouldn’t be in the same file as the text data for efficiency reasons. Perhaps they should be in a zipped folder as separate files? Open to ideas.

# URLs
- The main site is at book.pbe400.org. Accessing the root URL without an authentication token will result in being redirected to pbe400.org/book.
	- If they go to pbe400.org/book without an auth token, Ghost will already prompt them to login.
	- If the go to pbe400.org/book with an auth token, Ghost should redirect them to book.pbe400.org.
- Administrative URLs (functions available to Managers and Admins) will begin with /admin
- Other URLs will be REST-friendly, even if we don’t immediately implement an API.
	- /brother/\<id\> will be the information page for the brother with that ID.
	- Anything you can do that changes the user display (e.g. filtering, sorting) should change the URL so that going to that URL again will bring you to the same page of information with the same appearance.
		- If any of this is implemented as an SPA, the URL should be changed silently by the SPA using the HTML5 History API (et al) without doing a page reload.
- The site needs to run under HTTPS, with cryptographic credentials obtained using Let’s Encrypt

# Interactions with Other Systems
- Connection to Ghost
	- Should edits of email address or photo get pushed to Ghost automatically? (or batch before a new issue?)
- Connection to Linter
	- Book will be used by the PBE News Linter, a tool to help edit articles for the PBE News, as source of name and year information for both matching and canonicalization. Linter will primarily be interested in the name and class year fields as it will need to substitute Canonical Names for names written in draft articles in a variety of forms (e.g. Jamie Smyth ⇒ James Smyth ‘84).
- Connection to email lists
	- The current Mailman UI used by pbe-official and pbe-connect mailing lists is archaic, awkward, error prone, and insecure
	- We could potentially just have checkboxes in the Book UI for pbe-official and pbe-connect; if the brother clicks one, the user would be subscribed to the corresponding Mailman mailing list, and any changes they make to their email address would be made to the Mailman list, too; if they uncheck the box, Book would automatically unsubscribe them.
	- Note that Mailman only keeps track of email addresses, not names or any other identifying information. If a brother is subscribed to a Mailman list with a different email list today, we have no way to know who they are or which Book record corresponds to that Mailman address.
	- Should we provide an alternate front end for Mailman? Or build our own mailing list manager? So many corner cases... building ourself might not be wise? We may not want to address this now, but we should at least explore the possibilities, because if we don’t fix the problem of synchronization between Ghost and Mailman, we’ll continue to suffer problems with reaching brothers.
- Connection to MIT
	- We should periodically get an updated spreadsheet of data from MIT and use it to check for Book for updates we don’t have.
	- Should we periodically send MIT an update list? What format? I’m guessing changes only.

# Alternatives Considered
Two options were considered for the overall architecture:
1. A light-weight custom app running on a serverless platform like Google Cloud Run with a NoSQL database like FireBase. Compute and storage costs could very well be free for this option, and it would look and behave exactly the way we want, at the cost of needing to do the engineering work to create it.
2. Django, a widely used and very general application framework written in Python. Django comes “batteries included”, meaning that you can have a Django app up and running very quickly. The cost of creating a Django app is very low, but there are limits to its customizability and it’s quite heavyweight, leading to operational costs that would probably be in the range of $10–30/month.

A year ago, the cost of planning, designing, building, and testing a custom app would totally outweigh it’s operational cost savings. With the advent of AI assisted software engineering, however, those costs become negligible.

The Django Python application framework can easily do everything we need. Reasons to not use Django:
* Vanilla Django would need to be integrated with multiple add-ons to accomplish everything we want; in the end, it wouldn’t be “vanilla” Django at all, it would be heavily customized with multiple complex additions that alter it’s operation in fundamental ways. Achieving this wouldn’t be simple at all, and the result would be “brittle” since the add-ons are managed completely independently from Django and aren’t designed to be aware of each other.
	* Django is designed to run on a whole machine or VM, not as a serverless app that gets spun up and shut down on the fly. There are ways to mitigate cold start latency (e.g. Startup CPU Boost in Google Cloud Run).
	* Django is designed to work with a full-time SQL database, not a stateless Cloud Run instance. This could be mitigated by packaging Django with a SQLite database and Litestream, a side app that would sync the database to Google Cloud Storage at startup and shutdown.
* Django is designed to meet the needs of a very wide variety of use cases, and as such is very general and it includes many, many features we don’t need. It would work, but it’s a heavyweight solution that we can only control the tailoring of, not the fundamentals.

Another alternative considered was whether we should use a SQL or NoSQL database. NoSQL was selected due to the nature of the application, and to minimize the cost of serving infrastructure (the database is small enough that we can probably fit in the free tier of NoSQL services, but probably not for SQL services).

# Open Issues
* Thumbnails were a relatively late addition to my thinking about Book; I’d like them to be small in terms of number of bytes so that they can be downloaded with the profile database when the front end first loads. Depending on their size, though, that might not be feasible, both in terms of launch latency and browser memory requirements. This needs to be carefully considered: should thumbnails be loaded with the rest of the (non-headshot) profile database? Should they be loaded only when needed? Or will they cause a big enough hit to performance that we should eliminate them entirely?
* I’m concerned about how we’ll handle multiple users making changes to profiles at the same time. Usage will normally be low so it won’t be common for users to be using Book at the same time, though it will happen. It will be exceedingly rare for multiple users to update the same profile at the same time... but it’s not impossible for that to happen. How do we design the system to be robust in the face of these scenarios?
* The API is currently described as having the backend return all profile information in response to queries from the frontend. The frontend is then responsible for only displaying the fields the user is authorized to see (example: if a brother has said they don’t want to share their contact information, then the frontend is responsible for not displaying it unless the user is a manager or administrator). Perhaps this is a security/privacy issue—could the API results be intercepted (e.g. by Chrome Developer Tools), and thus “leak” private information? If this is a realistic risk, a solution might be for the frontend’s API call to include the ID of the user using it, and then the backend could only return the fields that user is authorized to see. This seems like a lot of complexity to add; is it worth it? Is this even an issue?

# Possible Future Work
## Ghost Content Search
* Ghost doesn’t have a proper search function; it’s search only searches article titles and authors, not article content, which severely limits it’s usefulness. The most useful thing to search for is brothers names in articles: e.g. show me all articles where James Smyth ‘84 is mentioned... but Ghost doesn’t do this today.
* Adding content search to Ghost isn’t something that could be done with a template—we’d either have to modify the Ghost application code (which we don’t have access to with Ghost Pro hosting), or we’d have to build an API somewhere else that does it that could be accessed by a Ghost template.
* One option: build Ghost content search into Book and expose it as an API accessible to Ghost templates. Book could periodically (once/day?) pull all Ghost article text (or just modified article text?) and index it. This isn’t a natural fit because this function has nothing to do with Book’s primary function as an address book, but it’s already in an adjacent DNS domain and running on a serverless platform we control that already needs to use the Ghost API for other things. That API call might be:
	* /contentsearch: An API request provide a search string; Book returns a list of Ghost articles that match that search string.

## Big Brother Graph Browser
“Big Brothers” are fraternity mentoring relationships in which a “little brother” chooses a “big brother” as their mentor. Every brother of PBE has a Big Brother, but not every brother is chosen to be a Big Brother themselves.

Book profiles contain a Big Brother field that points from that profile to the profiled brother’s own Big Brother. These points collectively form a directed tree.

The initial version of Book will support entering Big Brother information on profiles. A possible future addition to Book would be a function to graphically display the Big Brother directed tree with features like
* Allowing it to be browsed, panned, and zoomed
* Expand or collapse different nodes in the tree
* Clicking on a brother to switch to that brother’s profile page
* Clicking on Big Brother information on a brother’s profile page to switch to a view of their place in the graphical Big Brother tree.
* Possibly displaying headshot thumbnails on the graph to make it more visually interesting.

An application that does some of this today is at https://pbe.mit.edu/familytree. The advantages of moving this function to Book would include:
* The current familytree web app has the entire dataset hardcoded into it; it can only be updated by editing, rebuilding, and redeploying the the app. The Book version would be data-driven, pulling its data from the Book profile database.

For reference, the current familytree site is a React single-page app, rendered with D3 (using an SVG tree layout — the \#treeSvg element). The tree uses D3's Bezier curve path rendering for edges and SVG \<g\> + \<circle\> + \<text\> elements for nodes. It has several odd aspects, such as its entire database being hardcoded into the app itself; it’s statistics report is also hardcoded—not computed from the data; all years in its database are 4-digit strings... except for 2000, which is represented by “2e3”; and more.

## Mailman Interface
PBE has two mailing lists managed by an MIT-managed [GNU Mailman](https://list.org/) instance: pbe-official and pbe-connect. These lists are self-service today: anyone with their website address can join them or remove themselves directly, and it only tracks email addresses, no names. Consequently we have no idea who many of the people on these lists are, or if they are even members of the PBE. Further, many of the addresses bounce or are suspected of being inactive/unmonitored; quality of the addresses is poor. Finally, the Mailman interface is old and hard to use. The proposal here is to use Book as a frontend for Mailman; a brother’s profile page in Book would show whether they are subscribed to each list or not, and by changing a checkbox, the brother could subscribe or unsubscribe to them. Behind the scenes Book would make the appropriate updates to Mailman.

This would be both a great convivence, but Mailman was written in the 1990s so doesn’t offer modern features like a secure API, and this instance is managed by MIT, not us, so we can’t modify it. This means we’d likely have to interface with it by simulating a user using a browser and typing  an administrative password into it’s web UI... which is doable, but sketchy and brittle.

## External API
There’s currently no known use case requiring the Book API to be accessible to other applications, but one may  TK