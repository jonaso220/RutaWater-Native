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

def shots(name, kinds='iphone ipad android'):
    return {k: [f'{k}_{name}'] for k in kinds.split()}

SLIDES = [
    dict(name='reparto', eyebrow='Entrega de água', title='Sua rota, <em>em ordem</em>',
         sub='Cada parada com seus galões, suas notas e um toque para marcar como pronta.',
         accent=BLUE, layout='top', shots=shots('home')),
    dict(name='deudas', eyebrow='Cobranças', title='Dívidas <em>sob controle</em>',
         sub='Quem deve, quanto e desde quando. Registre pagamentos e envie lembretes.',
         accent=RED, layout='top', shots=shots('debts')),
    dict(name='whatsapp', eyebrow='WhatsApp e localização ao vivo', title='Avise que <em>está a caminho</em>',
         sub='Mensagens prontas para o WhatsApp, com um link para acompanhar o caminhão ao vivo.',
         accent=GREEN, layout='top', shots=shots('whatsapp')),
    dict(name='directorio', eyebrow='Diretório', title='Seus clientes, <em>à mão</em>',
         sub='Dias de visita, telefone e dívida de cada cliente. Agende uma visita com um toque.',
         accent=BLUE, layout='top', shots=shots('directory')),
    dict(name='productos', eyebrow='Produtos', title='Galões, sifões e <em>o que você entregar</em>',
         sub='Renomeie, oculte ou adicione os produtos da sua rota.',
         accent=AMBER, layout='top', shots=shots('products', 'iphone android')),
    dict(name='oscuro', eyebrow='Modo escuro', title='Também <em>à noite</em>',
         sub='Acompanha o tema claro ou escuro do seu celular.',
         accent=('#3B82F6', '#93C5FD'), layout='top', dark=True, shots=shots('dark', 'iphone android')),
]

if __name__ == '__main__':
    storekit.main(BRAND, SLIDES)
