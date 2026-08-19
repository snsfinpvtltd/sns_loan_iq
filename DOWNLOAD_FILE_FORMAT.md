# SNS CRM — Download File Format Guide

> Share this document with your integration team / calling system so they understand
> every column in the exported file and can map it correctly.

---

## What Is the Download File?

When you click **Download** in SNS CRM, the system exports all contacts (or a filtered
subset) as an **Excel `.xlsx`** or **CSV `.csv`** file. The file contains the contact's
identity, lead status, AI scores, financial profile, call history and raw AI data — all
in one flat sheet, ready for loading into any CRM, dialler, or analytics tool.

---

## File Formats

| Format | Extension | Notes |
|--------|-----------|-------|
| Excel  | `.xlsx`   | Colour-coded headers, frozen header row, auto-filter, section separators, score/status cell highlighting |
| CSV    | `.csv`    | UTF-8, comma-delimited, same column order, no formatting |

> **Recommendation:** Use `.xlsx` for human review. Use `.csv` for system-to-system integration.

---

## Column Layout — 37 Columns in 8 Sections

The file always has exactly **37 columns** in a fixed order.
Empty cells mean data is not yet available (not yet analysed / not yet called).

---

### Section A — Contact Identity *(Columns 1–4)*
> Header colour: **Navy**

| # | Column | Type | Description | Example |
|---|--------|------|-------------|---------|
| 1 | `ID` | Integer | Unique CRM record ID. Use this as the key when syncing back. | `101` |
| 2 | `Name` | Text | Contact's full name | `Ravi Kumar` |
| 3 | `Mobile` | Text | Mobile number as imported | `9876543210` |
| 4 | `Location` | Text | City / district / area as provided at import | `Pudukkottai` |

---

### Section B — Lead & Status *(Columns 5–9)*
> Header colour: **Dark Slate**

| # | Column | Type | Description | Example |
|---|--------|------|-------------|---------|
| 5 | `Lead Type` | Text | Type of financial product the contact was imported for | `Loan` / `Insurance` / `Both` |
| 6 | `Status` | Text | Current call/lead status in CRM | `Pending` / `Interested` / `Converted` — see full list below |
| 7 | `Imported At` | DateTime | Date & time the contact was added to CRM | `2026-05-20 09:15` |
| 8 | `Source Sheet` | Text | Sheet name or import batch the contact came from | `Sheet1` / `Walk-in May` |
| 9 | `Remarks` | Text | Free-text notes from the last call or import | `Existing customer, referred by branch` |

**Status values:**

| Value | Meaning |
|-------|---------|
| `Pending` | Not yet contacted |
| `Interested` | Expressed interest |
| `Not Interested` | Declined |
| `Call Back Later` | Requested follow-up |
| `No Answer` | Could not reach |
| `Converted` | Deal closed / loan disbursed |
| `Wrong Number` | Invalid contact number |
| `Invalid Number` | Number doesn't exist / can't be dialled |
| `Voice Mail` | Call went to voicemail |
| `Call Hang Up` | Contact hung up during the call |
| `Not Answering` | Rang but no one picked up |
| `Number Busy` | Line was busy |

---

### Section C — AI Score Summary *(Columns 10–12)*
> Header colour: **Dark Purple**

| # | Column | Type | Description | Example |
|---|--------|------|-------------|---------|
| 10 | `Final Score (0–100)` | Integer | Composite AI creditworthiness score. 0–100 scale. Green ≥70, Amber 45–69, Red <45. | `78` |
| 11 | `Grade` | Text | Letter grade derived from Final Score | `A` / `B` / `C` / `D` |
| 12 | `AI Analysis Status` | Text | Whether AI analysis has been run for this contact | `Done` / `Pending` / `Failed` / `Not Run` |

> **Grade bands:**
> - **A** — Score ≥ 70 (High creditworthiness)
> - **B** — Score 55–69 (Good)
> - **C** — Score 40–54 (Moderate)
> - **D** — Score < 40 (Low)

---

### Section D — Claude AI Sub-Scores *(Columns 13–17)*
> Header colour: **Medium Purple**

Each sub-score is out of **20**, and all five add up to the `Final Score`.

| # | Column | Type | Description | Example |
|---|--------|------|-------------|---------|
| 13 | `Data Quality /20` | Integer | Score based on completeness and quality of available data about the contact | `16` |
| 14 | `Location Score /20` | Integer | Economic strength of the contact's district/area | `14` |
| 15 | `Income Score /20` | Integer | Estimated income level and stability | `18` |
| 16 | `Repayment Score /20` | Integer | Likelihood of consistent repayment based on profile | `15` |
| 17 | `Product Fit /20` | Integer | How well the contact's profile matches the recommended financial product | `15` |

---

### Section E — Claude Analysis Detail *(Columns 18–22)*
> Header colour: **Indigo**

| # | Column | Type | Description | Example |
|---|--------|------|-------------|---------|
| 18 | `Location Type` | Text | Economic classification of the contact's area | `Tier-2 Urban` / `Rural Agricultural` / `Semi-Urban` |
| 19 | `AI Reasoning` | Text | Full natural-language reasoning from Claude AI explaining the score | `"Contact is located in Pudukkottai, a moderate economic zone..."` |
| 20 | `Key Insights` | Text (JSON) | Structured list of 3–5 key observations from AI analysis | `["Stable salaried employment", "Low-risk district"]` |
| 21 | `District Notes` | Text | Additional notes about the district's economic characteristics | `"Pudukkottai has moderate MSME density and average per-capita income"` |
| 22 | `AI Analysed At` | DateTime | Date & time when Claude AI last analysed this contact | `2026-05-22 14:30` |

---

### Section F — Financial Profile *(Columns 23–32)*
> Header colour: **Dark Teal**

| # | Column | Type | Description | Example |
|---|--------|------|-------------|---------|
| 23 | `Customer Profile` | Text | AI-assigned customer segment | `Salaried` / `Self-Employed` / `Farmer` / `Business Owner` |
| 24 | `Income Band` | Text | Estimated monthly income range | `₹15,000–25,000` / `₹25,000–50,000` |
| 25 | `Monthly Income (₹)` | Integer | Estimated monthly income in Rupees | `22000` |
| 26 | `Max Loan (₹)` | Integer | Maximum loan amount the contact can qualify for | `250000` |
| 27 | `Max EMI (₹)` | Integer | Maximum monthly EMI the contact can comfortably afford | `6500` |
| 28 | `Loan Tenure (Months)` | Integer | Recommended loan tenure in months | `48` |
| 29 | `Recommended Product` | Text | Best-fit financial product for this contact | `Personal Loan` / `Gold Loan` / `Home Loan` / `Term Insurance` |
| 30 | `Rec. Loan (₹)` | Integer | Recommended loan amount (conservative, within safe limits) | `200000` |
| 31 | `Rec. EMI (₹)` | Integer | Recommended monthly EMI for the suggested loan | `5200` |
| 32 | `FOIR %` | Integer | Fixed Obligation to Income Ratio — % of income going to EMIs. Lower is safer. | `35` |

---

### Section G — Call Tracking *(Columns 33–35)*
> Header colour: **Dark Green**

| # | Column | Type | Description | Example |
|---|--------|------|-------------|---------|
| 33 | `Call Script` | Text | AI-generated personalised call script for this contact | `"Good morning [Name], I'm calling from SNS Financial regarding a loan offer suited for..."` |
| 34 | `Called At` | DateTime | Date & time of the last recorded call | `2026-05-26 10:30` |
| 35 | `Called By` | Text | Name of the agent/caller who made the last call | `Priya S` |

---

### Section H — Raw AI Data (JSON) *(Columns 36–37)*
> Header colour: **Dark Grey**

| # | Column | Type | Description | Example |
|---|--------|------|-------------|---------|
| 36 | `Score Breakdown (JSON)` | JSON Text | Full structured score breakdown with reasoning per dimension | `{"data_quality":16,"location":14,"income":18,"repayment":15,"product_fit":15}` |
| 37 | `Risk Flags (JSON)` | JSON Text | List of risk factors identified by AI | `["No verifiable employment data","Rural area with low credit penetration"]` |

> Columns 36–37 are for advanced integration. Parse the JSON to extract individual flags
> or dimension scores for your own analytics pipeline.

---

## Sample Data

### Excel / Table View

| ID | Name | Mobile | Location | Lead Type | Status | Imported At | Source Sheet | Remarks | Final Score | Grade | AI Status | Data Quality | Location | Income | Repayment | Product Fit | Location Type | … |
|----|------|--------|----------|-----------|--------|-------------|--------------|---------|-------------|-------|-----------|-------------|----------|--------|-----------|-------------|---------------|---|
| 101 | Ravi Kumar | 9876543210 | Pudukkottai | Loan | Interested | 2026-05-20 09:15 | Sheet1 | Referred by branch | 78 | A | Done | 16 | 14 | 18 | 15 | 15 | Tier-2 Urban | … |
| 102 | Priya S | 9123456780 | Madurai | Insurance | Pending | 2026-05-20 09:15 | Sheet1 | | 65 | B | Done | 14 | 12 | 16 | 12 | 11 | Semi-Urban | … |
| 103 | Murugan T | 9000011112 | Trichy | Loan | Call Back Later | 2026-05-21 10:00 | Walk-in May | Call after 5 PM | 42 | C | Done | 10 | 8 | 10 | 7 | 7 | Rural Agricultural | … |
| 104 | Lakshmi K | 9988776655 | Chennai | Loan | Converted | 2026-05-22 11:30 | Sheet2 | Loan disbursed | 91 | A | Done | 18 | 18 | 20 | 18 | 17 | Metro | … |
| 105 | Anbu R | 9765432100 | Karur | Loan | Pending | 2026-05-23 14:00 | Sheet2 | | | | Not Run | | | | | | | … |

---

### Sample CSV (first 9 columns + score columns)

```csv
ID,Name,Mobile,Location,Lead Type,Status,Imported At,Source Sheet,Remarks,Final Score (0-100),Grade,AI Analysis Status,Data Quality /20,Location Score /20,Income Score /20,Repayment Score /20,Product Fit /20,Location Type,AI Reasoning,Key Insights,District Notes,AI Analysed At,Customer Profile,Income Band,Monthly Income (₹),Max Loan (₹),Max EMI (₹),Loan Tenure (Months),Recommended Product,Rec. Loan (₹),Rec. EMI (₹),FOIR %,Call Script,Called At,Called By,Score Breakdown (JSON),Risk Flags (JSON)
101,Ravi Kumar,9876543210,Pudukkottai,Loan,Interested,2026-05-20 09:15,Sheet1,Referred by branch,78,A,Done,16,14,18,15,15,Tier-2 Urban,"Pudukkottai is a moderate economic zone with growing MSME activity. Contact profile suggests stable income.","[""Stable income profile"",""Low-risk district"",""Good repayment capacity""]","Moderate MSME density, average per-capita income",2026-05-22 14:30,Salaried,₹20000–30000,25000,280000,6800,48,Personal Loan,220000,5500,32,"Good morning Ravi, I'm calling from SNS Financial with a personalised loan offer...",2026-05-26 10:30,Priya S,"{""data_quality"":16,""location"":14,""income"":18,""repayment"":15,""product_fit"":15}","[""No property ownership data""]"
102,Priya S,9123456780,Madurai,Insurance,Pending,2026-05-20 09:15,Sheet1,,65,B,Done,14,12,16,12,11,Semi-Urban,"Madurai is a Tier-2 city with mixed employment patterns.","[""Semi-urban location"",""Moderate income""]","Major textile and trade hub",2026-05-22 14:45,Self-Employed,₹15000–25000,18000,180000,4500,36,Term Insurance,,,28,"Hello Priya, we have an insurance plan designed for self-employed professionals...",,,"{"" data_quality"":14,""location"":12,""income"":16,""repayment"":12,""product_fit"":11}","[""Self-employed income variability""]"
105,Anbu R,9765432100,Karur,Loan,Pending,2026-05-23 14:00,Sheet2,,,,,,,,,,,,,,,,,,,,,,,,,,,
```

---

## How Filtering Affects the Download

When you download from the **Contacts** page using active filters, only the filtered
records are exported — the column structure is always the same 37 columns.

| Filter | What Is Exported |
|--------|-----------------|
| No filter | All contacts |
| Status = Interested | Only Interested contacts |
| Score = High (70+) | Only contacts with Final Score ≥ 70 |
| Grade = A | Only Grade A contacts |
| Not Analysed | Contacts not yet put through Claude AI |
| Search text | Contacts matching the search across Name / Mobile / Location |

---

## Integration Notes

### Key column for sync-back
Always retain the **`ID` column (col 1)**. When returning the file via the Sync
upload, include `ID` or `Mobile` so SNS CRM can match the row back to the right contact.

### Score interpretation

```
Final Score ≥ 70  →  High priority  →  Call first
Final Score 45–69 →  Medium priority →  Call after high-priority batch
Final Score < 45  →  Low priority   →  Call last or skip
```

### Filtering before calling
Use the `Final Score` and `Customer Profile` columns to segment:

| Segment | Filter | Action |
|---------|--------|--------|
| Hot leads | Score ≥ 70 AND Status = Pending | Assign to senior agents |
| Follow-up | Status = Call Back Later | Schedule callback |
| Insurance cross-sell | Lead Type = Loan AND Score ≥ 60 | Offer bundled insurance |
| Drop | Score < 30 OR Status = Wrong Number | Archive |

### JSON columns (36–37)
Parse `Score Breakdown (JSON)` to get per-dimension scores for custom dashboards:

```json
{
  "data_quality": 16,
  "location": 14,
  "income": 18,
  "repayment": 15,
  "product_fit": 15
}
```

Parse `Risk Flags (JSON)` to get a string array of risk factors:

```json
[
  "No verifiable employment data",
  "Rural area with low credit penetration",
  "High FOIR estimated"
]
```

---

## Quick Reference Card

```
SECTION A  │ Col  1– 4  │ ID, Name, Mobile, Location
SECTION B  │ Col  5– 9  │ Lead Type, Status, Imported At, Source, Remarks
SECTION C  │ Col 10–12  │ Final Score, Grade, AI Status
SECTION D  │ Col 13–17  │ Sub-scores: Data Quality, Location, Income, Repayment, Product Fit
SECTION E  │ Col 18–22  │ Location Type, AI Reasoning, Key Insights, District Notes, Analysed At
SECTION F  │ Col 23–32  │ Customer Profile, Income Band, Monthly Income, Max Loan, Max EMI,
           │            │ Tenure, Recommended Product, Rec. Loan, Rec. EMI, FOIR %
SECTION G  │ Col 33–35  │ Call Script, Called At, Called By
SECTION H  │ Col 36–37  │ Score Breakdown (JSON), Risk Flags (JSON)
```

---

## Workflow Summary

```
SNS CRM Download  →  Share file with calling team
        │
        ▼
Calling team works through contacts, updates Status / Caller / Comments
        │
        ▼
Team returns updated file
        │
        ▼
SNS CRM Upload → Sync Calling Data  →  All updates applied to CRM
```

---

*SNS Financial Services — Internal Document*
*For sync file format (uploading data back), see: **SYNC_FILE_FORMAT.md***
