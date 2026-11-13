import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
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

def shots(name, kinds='iphone ipad android'):
    return {k: [f'{k}_{name}'] for k in kinds.split()}

SLIDES = [
    dict(name='reparto', eyebrow='Reparto de agua', title='Tu reparto, <em>en orden</em>',
         sub='Cada parada con sus bidones, sus notas y un toque para marcarla como lista.',
         accent=BLUE, layout='top', shots=shots('home')),
    dict(name='deudas', eyebrow='Cobros', title='Deudas <em>bajo control</em>',
         sub='Quién debe, cuánto y desde cuándo. Registra pagos y envía recordatorios.',
         accent=RED, layout='top', shots=shots('debts')),
    dict(name='whatsapp', eyebrow='WhatsApp y ubicación en vivo', title='Avisa que <em>vas en camino</em>',
         sub='Mensajes listos para WhatsApp, con un enlace para seguir el camión en vivo.',
         accent=GREEN, layout='top', shots=shots('whatsapp')),
    dict(name='directorio', eyebrow='Directorio', title='Tus clientes, <em>a mano</em>',
         sub='Días de visita, teléfono y deuda de cada cliente. Agenda una visita en un toque.',
         accent=BLUE, layout='top', shots=shots('directory')),
    dict(name='productos', eyebrow='Productos', title='Bidones, sifones y <em>lo que repartas</em>',
         sub='Renombra, oculta o agrega los productos de tu reparto.',
         accent=AMBER, layout='top', shots=shots('products', 'iphone android')),
    dict(name='oscuro', eyebrow='Modo oscuro', title='También <em>de noche</em>',
         sub='Se adapta al tema claro u oscuro de tu teléfono.',
         accent=('#3B82F6', '#93C5FD'), layout='top', dark=True, shots=shots('dark', 'iphone android')),
]

if __name__ == '__main__':
    storekit.main(BRAND, SLIDES)
