public with sharing class UserCalendarController {
    private static final Set<String> ALLOWED_STATUS_VALUES = new Set<String>{
        'Not Started',
        'Completed',
        'Canceled'
    };

    public class FCEvent {
        @AuraEnabled public String id;
        @AuraEnabled public String title;
        @AuraEnabled public Datetime start;
        @AuraEnabled public Datetime endd; 
        @AuraEnabled public Boolean allDay;
        @AuraEnabled public String Status;
        @AuraEnabled public String whoId;
        @AuraEnabled public String whoObjectApiName;
        @AuraEnabled public String whatId;
        @AuraEnabled public String whatObjectApiName;
        @AuraEnabled public String campaignMemberId;
        @AuraEnabled public String campaignLabel;
        @AuraEnabled public String campaignName;

        public FCEvent() {}
        public FCEvent(Event e, String resolvedCampaignLabel, String resolvedCampaignName) {
            id     = e.Id;
            title  = String.isBlank(e.Subject) ? 'Event' : e.Subject;
            start  = e.StartDateTime;
            endd   = e.EndDateTime;
            allDay = e.IsAllDayEvent;
            Status = e.Status__c;
            whoId = e.WhoId;
            whoObjectApiName = e.WhoId != null ? e.WhoId.getSObjectType().getDescribe().getName() : null;
            whatId = e.WhatId;
            whatObjectApiName = e.WhatId != null ? e.WhatId.getSObjectType().getDescribe().getName() : null;
            campaignMemberId = e.CampaignMemberId__c;
            campaignLabel = resolvedCampaignLabel;
            campaignName = resolvedCampaignName;
        }
    }

    @AuraEnabled(cacheable=true)
    public static List<FCEvent> getMyEvents(Datetime start, Datetime endd, Long cacheBust) {
        if (start == null || endd == null) return new List<FCEvent>();
        Id me = UserInfo.getUserId();
        List<Event> rows = [
            SELECT Id, Subject, StartDateTime, EndDateTime, IsAllDayEvent, OwnerId, CreatedById, Status__c, WhoId, WhatId,
                   CampaignMemberId__c, TYPEOF What WHEN Campaign THEN Name, CampaignID__c END
            FROM Event
            WHERE StartDateTime < :endd
              AND EndDateTime   > :start
              AND (OwnerId = :me OR CreatedById = :me)
            ORDER BY StartDateTime ASC
            LIMIT 5000
        ];

        Set<Id> campaignMemberIds = new Set<Id>();
        for (Event e : rows) {
            if (String.isBlank(e.CampaignMemberId__c)) {
                continue;
            }
            try {
                campaignMemberIds.add((Id) e.CampaignMemberId__c);
            } catch (Exception ex) {
                // Ignore invalid values stored in the text field.
            }
        }

        Map<Id, String> campaignTagByCampaignMemberId = new Map<Id, String>();
        Map<Id, String> campaignNameByCampaignMemberId = new Map<Id, String>();
        if (!campaignMemberIds.isEmpty()) {
            for (CampaignMember member : [
                SELECT Id, Campaign.Name, Campaign.CampaignID__c
                FROM CampaignMember
                WHERE Id IN :campaignMemberIds
            ]) {
                if (member.Campaign == null) {
                    campaignTagByCampaignMemberId.put(member.Id, null);
                    campaignNameByCampaignMemberId.put(member.Id, null);
                    continue;
                }

                String campaignTag = member.Campaign.CampaignID__c;
                if (String.isBlank(campaignTag)) {
                    campaignTag = member.Campaign.Name;
                }
                campaignTagByCampaignMemberId.put(member.Id, campaignTag);
                campaignNameByCampaignMemberId.put(member.Id, member.Campaign.Name);
            }
        }

        List<FCEvent> outList = new List<FCEvent>();
        for (Event e : rows) {
            String campaignLabel;
            String campaignName;

            if (!String.isBlank(e.CampaignMemberId__c)) {
                try {
                    Id campaignMemberId = (Id) e.CampaignMemberId__c;
                    campaignLabel = campaignTagByCampaignMemberId.get(campaignMemberId);
                    campaignName = campaignNameByCampaignMemberId.get(campaignMemberId);
                } catch (Exception ex) {
                    campaignLabel = null;
                    campaignName = null;
                }
            }

            if (String.isBlank(campaignLabel) && e.WhatId != null && e.WhatId.getSObjectType() == Campaign.SObjectType) {
                SObject relatedWhat = e.getSObject('What');
                if (relatedWhat != null) {
                    campaignName = (String) relatedWhat.get('Name');
                    campaignLabel = (String) relatedWhat.get('CampaignID__c');
                    if (String.isBlank(campaignLabel)) {
                        campaignLabel = campaignName;
                    }
                }
            }

            outList.add(new FCEvent(e, campaignLabel, campaignName));
        }
        return outList;
    }

    @AuraEnabled
    public static void updateEventStatus(Id eventId, String statusValue) {
        if (eventId == null || String.isBlank(statusValue)) {
            throw new AuraHandledException('Event and status are required.');
        }

        String normalizedStatus = statusValue.trim();
        if (!ALLOWED_STATUS_VALUES.contains(normalizedStatus)) {
            throw new AuraHandledException('Unsupported status value.');
        }

        Id me = UserInfo.getUserId();
        Event eventRow = [
            SELECT Id, Status__c, OwnerId, CreatedById
            FROM Event
            WHERE Id = :eventId
              AND (OwnerId = :me OR CreatedById = :me)
            LIMIT 1
        ];

        eventRow.Status__c = normalizedStatus;
        update eventRow;
    }
}
