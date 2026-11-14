import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import storekit

ROOT = os.path.dirname(os.path.abspath(__file__))
BLUE = ('#1D4ED8', '#3B82F6')
GREEN = ('#047857', '#10B981')
RED = ('#B91C1C', '#EF4444')
AMBER = ('#B45309', '#F59E0B')
BRAND = dict(name='RutaWater',
             icon='/Volumes/OLIVERA/RutaWater-Native/ios/RutaWaterNative/Images.xcassets/AppIcon.appiconset/AppIcon-Light.png',
             dark=False, root=ROOT, base1='#FFFFFF', base2='#DCE9FB', text='#0F172A', sub='#475569',
             dark_base1='#17233D', dark_base2='#090E1A', dark_sub='#B7C3DA')

def shots(name, kinds='iphone ipad android tablet'):
    return {k: [f'{k}_{name}'] for k in kinds.split()}

SLIDES = [
    dict(name='reparto', eyebrow='Water delivery', title='Your route, <em>in order</em>',
         sub='Every stop with its bottles, its notes and one tap to mark it done.',
         accent=BLUE, layout='top', shots=shots('home')),
    dict(name='deudas', eyebrow='Payments', title='Debts <em>under control</em>',
         sub='Who owes, how much and since when. Record payments and send reminders.',
         accent=RED, layout='top', shots=shots('debts')),
    dict(name='whatsapp', eyebrow='WhatsApp and live location', title='Tell them <em>you’re on the way</em>',
         sub='Ready-made WhatsApp messages, with a link to follow the truck live.',
         accent=GREEN, layout='top', shots=shots('whatsapp')),
    dict(name='directorio', eyebrow='Directory', title='Your clients, <em>at hand</em>',
         sub='Visit days, phone and debt for every client. Schedule a visit in one tap.',
         accent=BLUE, layout='top', shots=shots('directory')),
    dict(name='productos', eyebrow='Products', title='Bottles, soda and <em>whatever you deliver</em>',
         sub='Rename, hide or add the products on your route.',
         accent=AMBER, layout='top', shots=shots('products', 'iphone android')),
    dict(name='oscuro', eyebrow='Dark mode', title='Also <em>at night</em>',
         sub='Follows your phone’s light or dark theme.',
         accent=('#3B82F6', '#93C5FD'), layout='top', dark=True, shots=shots('dark', 'iphone android')),
]

if __name__ == '__main__':
    storekit.main(BRAND, SLIDES)
