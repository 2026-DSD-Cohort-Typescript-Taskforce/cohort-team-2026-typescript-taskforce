# Bill intake

How a property management company takes in vendors' bills, completes their details, and sends them for payment.

## Language

**Bill**:
A vendor's request for payment for one property, tracked from intake until it is paid.
_Avoid_: Invoice (for the record in the app), payment

**Bill document**:
The PDF of the vendor's bill, attached to a bill.
_Avoid_: Attachment, upload, file

**Extraction**:
Reading a bill document with AI to fill in a bill's details.
_Avoid_: Parsing, scan, OCR

**Draft**:
A bill that has not been submitted for payment yet. A draft may be missing details.
_Avoid_: Pending, incomplete bill

**Current issue**:
A draft that is missing details it needs before it can be submitted.
_Avoid_: Failed extraction, error, problem

**Notice**:
A message under Current issues about an upload that left no draft to finish, such as a duplicate. It lasts until the page reloads.
_Avoid_: Alert, failed extraction

**Invoice number**:
The number the vendor printed on their bill. Shown as "Bill ID" in the Enter Bill Details form.
_Avoid_: Bill ID (that is the app's own number for a bill)

**Portal login**:
The username and password for a vendor's pay-online site, kept on the vendor.
_Avoid_: Credentials, account
