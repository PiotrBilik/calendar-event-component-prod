# Calendar Event Component Prod

Minimal Salesforce DX package for deploying the updated calendar component to production.

## Package Contents

- `force-app/main/default/classes/UserCalendarController.cls`
- `force-app/main/default/classes/UserCalendarController.cls-meta.xml`
- `force-app/main/default/lwc/userCalendarComponent/*`
- `manifest/package.xml`
- `sfdx-project.json`

## What Is Not Included

- sample or seed scripts
- local comparison folders
- editor settings
- development tooling such as `eslint`, `jest`, or `package.json`
- `FlexiPage` metadata, because the local record page matches the current production layout

## Main Changes Compared to the Old Calendar Version

### Apex

- `UserCalendarController.getMyEvents(...)` now returns additional event context:
  - `WhoId`
  - `WhatId`
  - `CampaignMemberId__c`
  - resolved campaign label and campaign name
- the controller now performs extra lookup logic for `CampaignMember` and campaign data
- a new Apex method `updateEventStatus(...)` allows quick status updates directly from the calendar
- supported quick status values are:
  - `Not Started`
  - `Completed`
  - `Canceled`

### Calendar Behavior

- the default view changes from `Month` to `Agenda`
- a new `Agenda` view is added
- users can filter events by:
  - search text
  - follow-up visibility
  - status
  - time range
- filter state is preserved in the browser session
- overdue events are surfaced in an operational alert banner
- alert items can be ignored and later restored during the same browser session
- clicking an event opens a quick actions modal instead of navigating directly to the event record

### Quick Actions

The new quick actions modal supports:

- `Open event`
- `Edit`
- `Mark completed`
- `Mark canceled`
- `Open campaign member`

### Campaign Context

- events can now display a campaign tag derived from `Campaign.CampaignID__c`
- if the campaign ID is missing, the UI falls back to the campaign name
- the full campaign name can be shown as supporting text

### UX and Display

- the `Month` view shows richer event cards and campaign tags
- the `Week` and `Day` views have improved event layout and overlap handling
- the `Day` view includes a focused daily summary
- the component refreshes automatically after returning from event edit or record navigation
  
