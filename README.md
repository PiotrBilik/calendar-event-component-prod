# Calendar Event Component Prod

Minimalny pakiet Salesforce DX do wdrożenia kalendarza na produkcję.

## Co zawiera

- `force-app/main/default/classes/UserCalendarController.cls`
- `force-app/main/default/lwc/userCalendarComponent/*`
- `manifest/package.xml`

## Czego nie zawiera

- skryptów seedujących i testowych
- porównań z produkcją
- ustawień VS Code
- narzędzi developerskich typu `eslint`, `jest`, `package.json`
- `FlexiPage`, bo lokalnie nie różni się od aktualnej produkcji

## Co wdraża

- logikę Apex pobierania eventów i szybkiej zmiany `Event.Status__c`
- komponent LWC `userCalendarComponent`

## Wymagania po stronie produkcji

Przed wdrożeniem potwierdź, że na produkcji istnieją i są dostępne:

- `Event.Status__c`
- `Event.CampaignMemberId__c`
- `Campaign.CampaignID__c`

Użytkownik wdrażający powinien mieć też prawo aktualizacji `Event.Status__c`.

## Przykładowa walidacja deployu

```bash
sf project deploy start --target-org otwarteklatki \
  --manifest manifest/package.xml \
  --dry-run
```

## Przykładowy deploy

```bash
sf project deploy start --target-org otwarteklatki \
  --manifest manifest/package.xml
```
